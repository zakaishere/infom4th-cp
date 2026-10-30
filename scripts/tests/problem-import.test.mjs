import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildProblemBank, writeProblemBank } from '../package-problem-bank.mjs';
import { gzipSync, gunzipSync } from 'node:zlib';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(root,'frontend/package.json'));
const ts=require('typescript');
const source=fs.readFileSync(path.join(root,'frontend/src/lib/problemImport.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2020}}).outputText;
const {parseProblemBank,readProblemBankFile,importProblem,MAX_BANK_BYTES}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const problem=()=>({slug:'test-sum',title:'Sum',statement:'Add',languages:['C'],
  tests:[{input:'2 3\n',expected:'5\n',sample:true},{input:'4 5\n',expected:'9\n',sample:false}],reference:{language:'C',sourceCode:'int main(void) { return 0; }'}});
const bank=p=>({format:'infom4th.problem-bank',version:1,problems:p});

test('reads actual JSON and gzip files, independent of filename, preserving all test text',async()=>{
  const value=bank([problem()]),data=JSON.stringify(value);
  const expected=parseProblemBank(value);
  assert.deepEqual(await readProblemBankFile(new Blob([data])),expected);
  assert.deepEqual(await readProblemBankFile(new Blob([gzipSync(data)])),expected);
  assert.deepEqual(await readProblemBankFile(new Blob(['\uFEFF'+data])),expected);
  assert.deepEqual(await readProblemBankFile(new Blob([gzipSync('\uFEFF'+data)])),expected);
});

test('reports incomplete JSON, truncated gzip and invalid UTF-8 clearly',async()=>{
  await assert.rejects(readProblemBankFile(new Blob(['{"format":'])),/not a complete JSON bank/);
  const compressed=gzipSync(JSON.stringify(bank([problem()])));
  await assert.rejects(readProblemBankFile(new Blob([compressed.subarray(0,compressed.length-8)])),/incomplete or damaged/);
  await assert.rejects(readProblemBankFile(new Blob([new Uint8Array([0xff,0xfe,0x7b,0x00])])),/not UTF-8/);
});

test('bounds decompressed data, including a small gzip that expands beyond the limit',async()=>{
  const compressed=gzipSync(Buffer.alloc(MAX_BANK_BYTES+1,32));
  assert.ok(compressed.length<100000);
  await assert.rejects(readProblemBankFile(new Blob([compressed])),/uncompressed bank exceeds 64 MiB/);
});

test('writes verified plain and compressed files with identical content',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cp-bank-write-')),file=path.join(temp,'bank.json');
  try {
    writeProblemBank(bank([problem()]),file);
    const plain=fs.readFileSync(file),compressed=fs.readFileSync(file+'.gz');
    assert.ok(gunzipSync(compressed).equals(plain));
    assert.deepEqual(await readProblemBankFile(new Blob([compressed])),parseProblemBank(JSON.parse(plain)));
  }finally{for(const name of fs.readdirSync(temp))fs.unlinkSync(path.join(temp,name));fs.rmdirSync(temp);}
});

test('reads the exact saved full-size upload files', {skip:!fs.existsSync(path.join(root,'examples/problem-bank.import.json.gz'))},async()=>{
  const dir=path.join(root,'examples'),plain=fs.readFileSync(path.join(dir,'problem-bank.import.json')),compressed=fs.readFileSync(path.join(dir,'problem-bank.import.json.gz'));
  assert.ok(gunzipSync(compressed).equals(plain));
  const parsed=await readProblemBankFile(new Blob([compressed]));
  assert.ok(parsed.length>=21);assert.equal(parsed.reduce((n,p)=>n+p.tests.length,0),parsed.length*20);
});

test('packages every real problem with exact tests, private editorials and sufficient output limits', {skip:!fs.existsSync(path.join(root,'examples/count-distinct/problem.json'))},()=>{
  const packaged=buildProblemBank(path.join(root,'examples')),parsed=parseProblemBank(packaged);
  assert.ok(parsed.length>=21);assert.equal(parsed.reduce((n,p)=>n+p.tests.length,0),parsed.length*20);
  for(const p of parsed){assert.equal(p.tests.filter(t=>t.sample).length,2);assert.equal(p.reference.language,'C');assert.equal(p.explanation,'');assert.ok(p.setterNotes.trim());
    for(const [i,t]of p.tests.entries()){const stem=String(i+1).padStart(2,'0');assert.equal(t.input,fs.readFileSync(path.join(root,'examples',p.slug,'tests',stem+'.in'),'utf8'));assert.equal(t.expected,fs.readFileSync(path.join(root,'examples',p.slug,'tests',stem+'.out'),'utf8'));}}
  const merge=parsed.find(p=>p.slug==='merge-sorted-arrays');assert.ok(merge.outputLimitKb>1024);
});

test('rejects bad versions, duplicate slugs and file-path manifests instead of inline test data',()=>{
  assert.throws(()=>parseProblemBank({...bank([problem()]),version:2}),/version/);
  assert.throws(()=>parseProblemBank(bank([problem(),problem()])),/Duplicate slug/);
  const p=problem();p.tests[0].sample='true';assert.throws(()=>parseProblemBank(bank([p])),/sample flag/);
  const q=problem();q.tests.forEach(t=>t.sample=true);assert.throws(()=>parseProblemBank(bank([q])),/hidden/);
  const r=problem();r.languages=['CPP'];assert.throws(()=>parseProblemBank(bank([r])),/Reference language/);
  const s=problem();s.tests=[{input:'tests/01.in',expected:'tests/01.out',sample:true}];assert.throws(()=>parseProblemBank(bank([s])),/2–200/);
});

test('bounds tests by UTF-8 bytes and preserves exact whitespace',()=>{
  const p=problem();p.tests[0].input='\n  hello  \n';assert.equal(parseProblemBank(bank([p]))[0].tests[0].input,p.tests[0].input);
  p.tests[0].input='a'.repeat(5*1024*1024);assert.doesNotThrow(()=>parseProblemBank(bank([p])));
  p.tests[0].input='é'.repeat(9*1024*1024);assert.throws(()=>parseProblemBank(bank([p])),/16 MiB/);
});

test('bounds expected output as well as time, memory, enums and statement fields',()=>{
  for(const change of [{timeLimitMs:60001},{memoryLimitMb:0},{outputLimitKb:0},{difficulty:'IMPOSSIBLE'},{checker:'CUSTOM'},{title:''},{languages:[null]}])assert.throws(()=>parseProblemBank(bank([{...problem(),...change}])));
  const p=problem();p.outputLimitKb=1;p.tests[0].expected='x'.repeat(1025);assert.throws(()=>parseProblemBank(bank([p])),/output limit/);
});

function fake({skip=false,fail=false,initial='DRAFT'}={}) {
  const calls=[];let status=initial,polls=0;
  return {calls,transport:{
    importProblem:async()=>{calls.push('import');return {outcome:skip?'SKIPPED':'IMPORTED',versionId:'v1'};},
    status:async()=>{calls.push('status');if(status==='IN_TESTING'&&++polls>=2){if(fail)return {status,validation_status:'FAILED'};status='READY_FOR_REVIEW';}return {status,validation_status:status==='DRAFT'?null:status==='IN_TESTING'?'RUNNING':'PASSED'};},
    action:async(_id,action)=>{calls.push(action);if(action==='validate')status='IN_TESTING';if(action==='approve')status='APPROVED';if(action==='publish-practice')status='PUBLISHED';},
    wait:async()=>{calls.push('wait');},
  }};
}
const parsedProblem=()=>parseProblemBank(bank([problem()]))[0];

test('draft-only import never queues, approves or publishes',async()=>{
  const f=fake();assert.equal(await importProblem(parsedProblem(),'draft',f.transport,()=>{},()=>false),'done');assert.deepEqual(f.calls,['import']);
});
test('existing slugs are skipped without validating or changing the existing problem',async()=>{
  const f=fake({skip:true});assert.equal(await importProblem(parsedProblem(),'publish',f.transport,()=>{},()=>false),'skipped');assert.deepEqual(f.calls,['import']);
});
test('publication waits for a passing validation and approval, in that order',async()=>{
  const f=fake();await importProblem(parsedProblem(),'publish',f.transport,()=>{},()=>false);
  assert.ok(f.calls.indexOf('validate')<f.calls.indexOf('approve'));assert.ok(f.calls.indexOf('approve')<f.calls.indexOf('publish-practice'));
  assert.ok(f.calls.includes('wait'));
});
test('failed validation cannot approve or publish',async()=>{
  const f=fake({fail:true});await assert.rejects(importProblem(parsedProblem(),'publish',f.transport,()=>{},()=>false),/Validation failed/);
  assert.ok(!f.calls.includes('approve')&&!f.calls.includes('publish-practice'));
});
test('retry resumes the saved version and never imports it a second time',async()=>{
  const f=fake({initial:'READY_FOR_REVIEW'});await importProblem(parsedProblem(),'publish',f.transport,()=>{},()=>false,'v1');
  assert.deepEqual(f.calls,['status','approve','publish-practice']);
});
test('stop after saving prevents later validation/approval/publication',async()=>{
  const f=fake();let stopped=false;
  await assert.rejects(importProblem(parsedProblem(),'publish',f.transport,update=>{if(update.message==='Draft saved')stopped=true;},()=>stopped),/Stopped/);
  assert.deepEqual(f.calls,['import']);
});
test('stalled validation has a bounded wait and remains resumable',async()=>{
  const f=fake();f.transport.status=async()=>({status:'IN_TESTING',validation_status:'PENDING'});
  await assert.rejects(importProblem(parsedProblem(),'publish',f.transport,()=>{},()=>false,'v1',1),/still queued/);
  assert.ok(!f.calls.includes('approve')&&!f.calls.includes('publish-practice'));
});
test('packager rejects manifest traversal outside the problem folder',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cp-bank-test-')),dir=path.join(temp,'problem');fs.mkdirSync(dir);
  fs.writeFileSync(path.join(temp,'secret.txt'),'not a problem file');
  fs.writeFileSync(path.join(dir,'problem.json'),JSON.stringify({tests:[{input:'../secret.txt',expected:'../secret.txt',sample:true}]}));
  try {assert.throws(()=>buildProblemBank(temp),/escapes/);}
  finally {fs.unlinkSync(path.join(dir,'problem.json'));fs.rmdirSync(dir);fs.unlinkSync(path.join(temp,'secret.txt'));fs.rmdirSync(temp);}
});
