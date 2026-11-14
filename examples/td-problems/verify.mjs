// Checks the TD bank: every test has a sample/hidden manifest entry, and, with --cc <compiler>,
// compiles every solution.c and compares its output with the saved expected output using the
// problem's checker (same rules as judge/runner.py).
// Run from the repository root:  node examples/td-problems/verify.mjs [--cc gcc]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const ccIndex=process.argv.indexOf('--cc'),cc=ccIndex>0?process.argv[ccIndex+1]:null;
const normalize=s=>s.replace(/\r\n/g,'\n').split('\n').map(l=>l.trimEnd()).join('\n').replace(/^\n+|\n+$/g,'');
const matches=(actual,expected,checker)=>checker==='EXACT'?actual===expected
  :checker==='TOKENS'?actual.split(/\s+/).filter(Boolean).join(' ')===expected.split(/\s+/).filter(Boolean).join(' ')
  :normalize(actual)===normalize(expected);

const slugs=JSON.parse(fs.readFileSync(path.join(root,'index.json'),'utf8'));
let failures=0,runs=0;
const work=fs.mkdtempSync(path.join(os.tmpdir(),'td-verify-'));
for(const slug of slugs) {
  const dir=path.join(root,slug),meta=JSON.parse(fs.readFileSync(path.join(dir,'problem.json'),'utf8'));
  if(!meta.tests.some(t=>t.sample)||!meta.tests.some(t=>!t.sample)){console.log(`${slug}: needs sample and hidden tests`);failures++;}
  if(!cc)continue;
  const binary=path.join(work,slug);
  try{execFileSync(cc,['-std=c11','-O2','-Wall','-Wextra','-Werror','-o',binary,path.join(dir,'solution.c'),'-lm'],{stdio:'pipe'});}
  catch(e){console.log(`${slug}: compile error\n${e.stderr}`);failures++;continue;}
  for(const t of meta.tests) {
    const input=fs.readFileSync(path.join(dir,t.input)),expected=fs.readFileSync(path.join(dir,t.expected),'utf8');
    const run=spawnSync(binary,{input,timeout:5000});runs++;
    const actual=run.stdout?.toString('utf8')??'';
    if(run.status!==0||!matches(actual,expected,meta.checker)) {
      failures++;console.log(`${slug} ${t.input}: ${run.status!==0?'exit '+run.status:'wrong answer'}\n  expected: ${JSON.stringify(expected.slice(0,200))}\n  actual:   ${JSON.stringify(actual.slice(0,200))}`);
    }
  }
}
fs.rmSync(work,{recursive:true,force:true});
console.log(failures?`${failures} problem(s) failed`:`OK: ${slugs.length} problems${cc?`, ${runs} runs of the C references`:''}`);
process.exit(failures?1:0);
