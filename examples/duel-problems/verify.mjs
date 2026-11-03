// Checks every blitz test: input within the stated limits, and both the Java reference
// (compiled with javac) and the Node.js reference print the expected answer.
// Run from the repository root:  node examples/duel-problems/verify.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const tokens=s=>s.trim().split(/\s+/).join(' ');
const ints=(s,n)=>{const a=s.trim().split(/\s+/).map(Number);assert.ok(a.every(Number.isSafeInteger));if(n!==undefined)assert.equal(a.length,n);return a;};
const big=s=>{assert.match(s.trim(),/^\d+$/);const v=BigInt(s.trim());assert.ok(v>=0n&&v<=10n**18n);};
function array(s,min,offset=1) {
  const a=ints(s),n=a[0];assert.ok(n>=min&&n<=100000);assert.equal(a.length,n+offset);
  assert.ok(a.slice(offset).every(x=>Math.abs(x)<=1e9));return a;
}
const LIMITS={
  'blitz-digit-sum':big,'blitz-binary':big,
  'blitz-reverse-words':s=>{const w=s.trim().split(' ');assert.ok(w.length>=1&&w.length<=1000);for(const x of w)assert.match(x,/^[a-z0-9]{1,20}$/);},
  'blitz-second-largest':s=>array(s,2),'blitz-longest-run':s=>array(s,1),'blitz-first-missing':s=>array(s,1),
  'blitz-rotate-right':s=>{const a=array(s,1,2);assert.ok(a[1]>=0&&a[1]<=1e9);},
  'blitz-collatz-steps':s=>{const [n]=ints(s,1);assert.ok(n>=1&&n<=1e6);},
  'blitz-count-primes':s=>{const [n]=ints(s,1);assert.ok(n>=0&&n<=1e6);},
  'blitz-run-length':s=>{assert.match(s.trim(),/^[a-z]{1,100000}$/);},
  'blitz-best-trade':s=>{const a=array(s,1);assert.ok(a.slice(1).every(x=>x>=1));},
  'blitz-pair-sums':s=>{const a=array(s,1,2);assert.ok(Math.abs(a[1])<=2e9);},
};
const javaHome=process.env.JAVA_HOME;
const javac=javaHome?path.join(javaHome,'bin','javac'):'javac',javaBin=javaHome?path.join(javaHome,'bin','java'):'java';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'infom4th-blitz-'));
let count=0;
try {
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'index.json'),'utf8'));
  for(const slug of catalog) {
    const dir=path.join(root,slug),p=JSON.parse(fs.readFileSync(path.join(dir,'problem.json'),'utf8'));
    assert.equal(p.slug,slug);assert.ok(LIMITS[slug],slug+': no input limits defined');
    assert.equal(p.tests.filter(t=>t.sample).length,2);assert.ok(p.tests[0].sample&&p.tests[1].sample);
    const classes=path.join(temp,slug);fs.mkdirSync(classes);
    const build=spawnSync(javac,['-d',classes,path.join(dir,'Main.java')],{encoding:'utf8'});
    assert.equal(build.status,0,`${slug}: javac failed: ${build.error??build.stderr}`);
    for(const t of p.tests) {
      const input=fs.readFileSync(path.join(dir,t.input),'utf8'),expected=fs.readFileSync(path.join(dir,t.expected),'utf8');
      assert.ok(input.endsWith('\n')&&expected.endsWith('\n')&&!input.includes('\r'));
      LIMITS[slug](input);
      for(const [command,args,label] of [[process.execPath,[path.join(dir,'solution.js')],'Node.js'],[javaBin,['-Xss64m','-cp',classes,'Main'],'Java']]) {
        const started=Date.now();
        const r=spawnSync(command,args,{input,encoding:'utf8',timeout:20000,maxBuffer:16*1024*1024});
        assert.equal(r.status,0,`${slug}/${t.input} ${label}: ${r.error??r.stderr}`);
        assert.equal(tokens(r.stdout),tokens(expected),`${slug}/${t.input}: wrong ${label} output`);
        if(label==='Java'&&Date.now()-started>1500)console.log(`  slow: ${slug}/${t.input} Java ${Date.now()-started} ms (includes JVM start)`);
      }
      count++;
    }
    console.log(`PASS ${slug}: ${p.tests.length} tests (Java + Node.js)`);
  }
  console.log(`Verified ${count} tests in ${catalog.length} problems.`);
} finally {
  fs.rmSync(temp,{recursive:true,force:true});
}
