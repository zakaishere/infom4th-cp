// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
let n=BigInt(text.trim()),sum=0n;
while(n>0n){sum+=n%10n;n/=10n;}
console.log(String(sum));
