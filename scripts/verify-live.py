"""Real API -> RabbitMQ -> Linux Docker load verification. Creates isolated test data."""
import argparse
import concurrent.futures
import datetime
import json
import os
import statistics
import threading
import time
import urllib.request
import uuid
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url",default="http://127.0.0.1:8081")
    parser.add_argument("--users",type=int,default=100)
    parser.add_argument("--timeout",type=int,default=900)
    parser.add_argument("--official-limit",type=int,default=None,
                        help="Temporarily set the global official concurrency limit and verify the observed peak never exceeds it")
    args=parser.parse_args()
    if not 1<=args.users<=100:
        parser.error("--users must be between 1 and 100")
    base=args.base_url.rstrip("/")
    sessions={}
    session_lock=threading.Lock()
    def remember(session):
        with session_lock:
            sessions[session["accessToken"]]={"access":session["accessToken"],"refresh":session["refreshToken"],"expires":time.monotonic()+session["expiresIn"]}
        return session
    def request(method,path,body=None,token=None,key=None):
        headers={"Content-Type":"application/json"}
        if token:
            with session_lock:
                session=sessions.get(token)
                if session and session["expires"]-time.monotonic()<30:
                    refresh_request=urllib.request.Request(base+"/api/auth/refresh",data=json.dumps({"refreshToken":session["refresh"]}).encode(),headers={"Content-Type":"application/json"},method="POST")
                    with urllib.request.urlopen(refresh_request,timeout=30) as response:
                        refreshed=json.loads(response.read())
                    session.update(access=refreshed["accessToken"],refresh=refreshed["refreshToken"],expires=time.monotonic()+refreshed["expiresIn"])
                headers["Authorization"]="Bearer "+(session["access"] if session else token)
        if key:headers["Idempotency-Key"]=key
        data=None if body is None else json.dumps(body).encode()
        with urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers=headers,method=method),timeout=30) as response:
            raw=response.read()
            return json.loads(raw) if raw else None
    admin=remember(request("POST","/api/auth/login",{"email":os.environ["CP_TEST_ADMIN_EMAIL"],"password":os.environ["CP_TEST_ADMIN_PASSWORD"]}))["accessToken"]
    capacity=request("GET","/api/admin/judging/settings",token=admin)
    previous_limit=capacity["settings"]["officialConcurrencyLimit"]
    if args.official_limit is not None:
        capacity=request("PATCH","/api/admin/judging/settings",{"version":capacity["settings"]["version"],
            "reason":"Live verification concurrency check","officialConcurrencyLimit":args.official_limit},admin)
    expected_peak=capacity["lanes"]["official"]["effectiveCapacity"]
    print("Official effective capacity:",expected_peak,"constraints:",capacity["lanes"]["official"]["constraints"])
    infrastructure=request("GET","/api/admin/judge",token=admin)
    manifests=[json.loads(w["runtime_manifest"]) for w in infrastructure["workers"] if w["status"]=="ONLINE"]
    internal=[m["CPP"]["imageId"] for m in manifests if m.get("lane")=="internal" and m.get("CPP",{}).get("verified")]
    official=[m["CPP"]["imageId"] for m in manifests if m.get("lane")=="official" and m.get("CPP",{}).get("verified")]
    common=set(internal)&set(official)
    if not common:raise RuntimeError("Verified internal and official CPP workers with the same image are required")
    request("PUT","/api/admin/languages/CPP",{"enabled":True,"imageId":sorted(common)[0],"reason":"Local load verification"},admin)
    marker="load-"+uuid.uuid4().hex[:12]
    problem=request("POST","/api/lab/problems",{"slug":marker,"title":"Load verification sum","statement":"Read two integers and print their sum.","languages":["CPP"],"timeLimitMs":2000},admin)["versionId"]
    request("PUT",f"/api/lab/problems/{problem}/tests",[
        {"input":"2 3\n","expected":"5\n","sample":True},
        {"input":"100 200\n","expected":"300\n","sample":False},
        {"input":"-5 2\n","expected":"-3\n","sample":False}],admin)
    source='#include <iostream>\nint main(){long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}'
    request("POST",f"/api/lab/problems/{problem}/references",{"label":"Correct","language":"CPP","sourceCode":source,"expectedVerdict":"ACCEPTED"},admin)
    request("POST",f"/api/lab/problems/{problem}/validate",{},admin)
    deadline=time.monotonic()+args.timeout
    while True:
        detail=request("GET",f"/api/lab/problems/{problem}",token=admin)
        status=detail["validations"][0]["status"]
        if status=="PASSED":break
        if status in ("FAILED","JUDGE_ERROR"):raise RuntimeError("Real reference validation failed")
        if time.monotonic()>deadline:raise TimeoutError("Reference validation timed out")
        time.sleep(1)
    request("POST",f"/api/lab/problems/{problem}/approve",{"reason":"Real sandbox reference passed"},admin)
    contest=request("POST","/api/manage/competitions",{"slug":marker,"title":"Local 100-user verification","durationSeconds":60,"languages":["CPP"]},admin)["competitionId"]
    request("POST",f"/api/manage/competitions/{contest}/problems",{"versionId":problem,"slot":1,"label":"A"},admin)
    rehearsal=request("POST",f"/api/manage/competitions/{contest}/rehearsals",{},admin)["runId"]
    request("POST",f"/api/manage/runs/{rehearsal}/control",{"action":"end-rehearsal","reason":"Readiness rehearsal created"},admin)
    def account(i):
        handle=(marker.replace("-","")+str(i))[:32]
        return remember(request("POST","/api/auth/register",{"email":handle+"@example.test","handle":handle,"displayName":"Load tester "+str(i),"password":"LoadTest1!"+uuid.uuid4().hex}))
    print("Creating",args.users,"test participants")
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        users=list(pool.map(account,range(args.users)))
    start=datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=20)
    run=request("POST",f"/api/manage/competitions/{contest}/schedule",{"startsAt":start.isoformat().replace("+00:00","Z"),"visibility":"UNLISTED"},admin)["runId"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        list(pool.map(lambda u:request("POST",f"/api/competitions/{contest}/register",{},u["accessToken"]),users))
    while datetime.datetime.now(datetime.timezone.utc)<start:time.sleep(0.1)
    submit_path=f"/api/runs/{run}/problems/1/submissions"
    def submit(user):
        key=str(uuid.uuid4());began=time.perf_counter()
        result=request("POST",submit_path,{"language":"CPP","sourceCode":source},user["accessToken"],key)
        return {"id":result["submissionId"],"token":user["accessToken"],"key":key,"latencyMs":1000*(time.perf_counter()-began)}
    print("Submitting simultaneous burst")
    began=time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.users) as pool:
        submissions=list(pool.map(submit,users))
    duplicate=request("POST",submit_path,{"language":"CPP","sourceCode":source},submissions[0]["token"],submissions[0]["key"])
    assert duplicate["submissionId"]==submissions[0]["id"],"Duplicate request created another submission"
    pending={s["id"]:s for s in submissions}
    verdicts=[]
    peak={"running":0}
    sampling=threading.Event()
    def sample():
        # Observed through the admin API; RUNNING counts come from PostgreSQL job rows.
        while not sampling.is_set():
            try:
                lane=request("GET","/api/admin/judging/settings",token=admin)["lanes"]["official"]
                peak["running"]=max(peak["running"],lane["running"])
            except Exception:
                pass
            sampling.wait(0.5)
    sampler=threading.Thread(target=sample,daemon=True)
    sampler.start()
    while pending:
        if time.monotonic()-began>args.timeout:raise TimeoutError("Judging did not drain within the test budget")
        for identity,item in list(pending.items()):
            result=request("GET","/api/submissions/"+identity,token=item["token"])["judging"][0]
            if result["status"]=="FAILED":raise RuntimeError("Judge exhausted retries")
            if result["status"]=="COMPLETED":
                assert result["verdict"]=="ACCEPTED",result
                verdicts.append(result["verdict"]);del pending[identity]
        if pending:time.sleep(1)
    sampling.set()
    sampler.join(timeout=5)
    if args.official_limit is not None:
        current=request("GET","/api/admin/judging/settings",token=admin)["settings"]
        request("PATCH","/api/admin/judging/settings",{"version":current["version"],"reason":"Restore after live verification",
            "officialConcurrencyLimit":previous_limit},admin)
        assert peak["running"]<=args.official_limit,f"Observed {peak['running']} running official jobs above the limit {args.official_limit}"
    public=request("GET",f"/api/runs/{run}/standings",token=users[0]["accessToken"])
    jury=request("GET",f"/api/runs/{run}/standings?jury=true",token=admin)
    assert len(jury["standings"])==args.users
    assert all(s["solved"]==1 for s in jury["standings"])
    assert len(public["standings"])==args.users
    times=sorted(s["latencyMs"] for s in submissions)
    report={"contestId":contest,"runId":run,"participants":args.users,"accepted":len(verdicts),
            "submitP95Ms":times[min(len(times)-1,int(len(times)*0.95))],
            "submitMedianMs":statistics.median(times),"drainSeconds":time.monotonic()-began,
            "duplicateRequestPreservedSubmission":True,"officialLimit":args.official_limit,
            "officialEffectiveCapacity":expected_peak,"observedPeakRunningOfficial":peak["running"],
            "test":"real-api-rabbitmq-docker"}
    output=Path(__file__).resolve().parents[1]/".local"/(marker+"-report.json")
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps(report,indent=2))
    print("Report:",output)

if __name__=="__main__":
    main()
