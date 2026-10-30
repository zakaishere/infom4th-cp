// Build one uploadable JSON bank without executing any reference solution.
// Usage: node scripts/package-problem-bank.mjs [source-directory] [output-file]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

export function writeProblemBank(bank, output) {
  const data=Buffer.from(JSON.stringify(bank)+'\n','utf8');
  if(data.length>64*1024*1024)throw new Error('Bank exceeds 64 MiB; package smaller groups');
  const compressed=gzipSync(data,{level:9});
  if(!gunzipSync(compressed).equals(data))throw new Error('Compressed bank verification failed');
  const recovered=JSON.parse(data.toString('utf8'));
  if(recovered.format!=='infom4th.problem-bank'||recovered.version!==1||!Array.isArray(recovered.problems))throw new Error('Invalid bank format');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,data);
  fs.writeFileSync(output+'.gz',compressed);
  if(!fs.readFileSync(output).equals(data)||!gunzipSync(fs.readFileSync(output+'.gz')).equals(data))throw new Error('Saved bank verification failed');
  return {bytes:data.length,compressedBytes:compressed.length};
}

function readWithin(directory, filename) {
  if(typeof filename!=='string'||path.isAbsolute(filename))throw new Error('Invalid relative file path');
  const root=fs.realpathSync(directory),resolved=fs.realpathSync(path.resolve(root,filename));
  const relative=path.relative(root,resolved);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('File escapes its problem folder: '+filename);
  return fs.readFileSync(resolved,'utf8');
}

export function buildProblemBank(source) {
  const problems=[];
  for(const entry of fs.readdirSync(source,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    if(!entry.isDirectory())continue;
    const directory=path.join(source,entry.name),manifest=path.join(directory,'problem.json');
    let meta;
    if(fs.existsSync(manifest))meta=JSON.parse(fs.readFileSync(manifest,'utf8'));
    else if(entry.name==='even-sum'&&fs.existsSync(path.join(directory,'tests'))) {
      // Legacy example predates the generated manifests; preserve its exact test files.
      meta={slug:'even-sum',title:'Even Sum',difficulty:'EASY',checker:'TOKENS',timeLimitMs:1000,memoryLimitMb:256,
        languages:['C','CPP','JAVA','PYTHON'],referenceLanguage:fs.existsSync(path.join(directory,'solution.c'))?'C':'CPP',
        referenceFile:fs.existsSync(path.join(directory,'solution.c'))?'solution.c':'solution.cpp',
        statement:'You are given a list of n integers. Print the sum of the even numbers in the list. If there is no even number, print 0. Negative numbers and zero can be even.',
        inputFormat:'The first line contains n. The second line contains n integers a1, a2, ..., an.',
        outputFormat:'Print one integer: the sum of all even ai.',constraints:'1 <= n <= 100000; -10^9 <= ai <= 10^9. Use 64-bit integers: the answer can have magnitude 10^14.',
        explanation:'Scan the array and accumulate even values in a 64-bit integer. O(n) time and O(1) extra space.',
        tests:fs.readdirSync(path.join(directory,'tests')).filter(name=>name.endsWith('.in')).sort().map((name,i)=>({input:'tests/'+name,expected:'tests/'+name.replace(/\.in$/,'.out'),sample:i<2}))};
    } else continue;
    const tests=meta.tests.map(t=>({input:readWithin(directory,t.input),expected:readWithin(directory,t.expected),sample:t.sample}));
    const largestOutput=Math.max(...tests.map(t=>Buffer.byteLength(t.expected,'utf8')));
    problems.push({slug:meta.slug,title:meta.title,difficulty:meta.difficulty,checker:meta.checker,timeLimitMs:meta.timeLimitMs,memoryLimitMb:meta.memoryLimitMb,
      outputLimitKb:Math.max(meta.outputLimitKb??1024,Math.ceil(largestOutput/1024)+64),languages:meta.languages,
      statement:meta.statement,inputFormat:meta.inputFormat,outputFormat:meta.outputFormat,constraints:meta.constraints,
      // Generated "explanation" is an algorithm editorial, not a public sample note.
      explanation:'',setterNotes:[meta.explanation,meta.source,meta.tags?.length?'Topics: '+meta.tags.join(', '):''].filter(Boolean).join('\n\n'),
      tests,reference:{label:'Main solution',language:meta.referenceLanguage,sourceCode:readWithin(directory,meta.referenceFile)}});
  }
  if(!problems.length)throw new Error('No problem manifests found');
  return {format:'infom4th.problem-bank',version:1,problems};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const source=path.resolve(process.argv[2]??path.join(root,'examples'));
  const output=path.resolve(process.argv[3]??path.join(source,'problem-bank.import.json'));
  const bank=buildProblemBank(source),sizes=writeProblemBank(bank,output);
  console.log(`Verified ${bank.problems.length} problems and ${bank.problems.reduce((n,p)=>n+p.tests.length,0)} tests.`);
  console.log(`JSON: ${(sizes.bytes/1048576).toFixed(1)} MiB - ${output}`);
  console.log(`Compressed: ${(sizes.compressedBytes/1048576).toFixed(1)} MiB - ${output}.gz`);
}
