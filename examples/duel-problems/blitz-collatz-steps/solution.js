// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
let x=BigInt(text.trim()),steps=0;
while(x!==1n){x=x%2n===0n?x/2n:3n*x+1n;steps++;}
console.log(steps);
