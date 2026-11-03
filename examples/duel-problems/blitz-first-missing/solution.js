// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
const a=text.trim().split(/\s+/).slice(1).map(Number).filter(x=>x>0).sort((x,y)=>x-y);let answer=1;
for(const x of a){if(x===answer)answer++;else if(x>answer)break;}
console.log(answer);
