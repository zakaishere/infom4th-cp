// Blitz bank: twelve short problems for duels. Each is readable in under a minute and solvable
// in a few, with 12 tests (2 examples + 10 hidden) so a duel verdict comes back quickly.
// Every expected output comes from an oracle in this file, written independently of the Java
// reference (Main.java, uploaded to the platform) and the Node.js reference (solution.js).
// Run from the repository root:  node examples/duel-problems/generate.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
let seed=20261103;
const random=(lo,hi)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return lo+seed%(hi-lo+1);};
const array=(n,lo=-1000000000,hi=1000000000)=>Array.from({length:n},()=>random(lo,hi));
const word=(lo,hi,letters='abcdefghijklmnopqrstuvwxyz')=>Array.from({length:random(lo,hi)},()=>letters[random(0,letters.length-1)]).join('');
const bigDigits=n=>String(random(1,9))+Array.from({length:n-1},()=>random(0,9)).join('');
const arrInput=a=>`${a.length}\n${a.join(' ')}\n`;
const TESTS=12;
const java=body=>`import java.io.*;
import java.util.*;

public class Main {
${body.trim().split('\n').map(l=>'    '+l).join('\n')}
}
`;
const js=body=>`// Independent Node.js reference for local verification.
const text=require('node:fs').readFileSync(0,'utf8');
${body.trim()}
`;
// Reads every whitespace-separated token; inputs here are at most a few hundred kilobytes.
const READ='static String[] tokens() throws IOException { return new String(System.in.readAllBytes()).trim().split("\\\\s+"); }';

const problems=[];
function add(p,cases,oracle,purpose) {
  assert.equal(cases.length,TESTS,p.slug);
  problems.push({...p,timeLimitMs:2000,memoryLimitMb:256,checker:'TOKENS',languages:['C','CPP','JAVA','PYTHON'],
    tests:cases.map(input=>({input,expected:String(oracle(input)).trimEnd()+'\n',purpose}))});
}

// ---------- EASY ----------
{
  const cases=['12345\n','0\n','7\n','1000000000000000000\n','999999999999999999\n','10\n','909090909\n'];
  while(cases.length<TESTS)cases.push(bigDigits(random(10,18))+'\n');
  add({slug:'blitz-digit-sum',title:'Digit Sum',difficulty:'EASY',tags:['math','strings','blitz'],
    statement:'Print the sum of the decimal digits of a non-negative integer **n**.',
    inputFormat:'One line with the integer n.',outputFormat:'Print one integer: the sum of the digits of n.',
    constraints:'0 <= n <= 10^18. The value does not fit in a 32-bit integer.',
    explanation:'Read n as a string (or a 64-bit integer) and add its digits. O(number of digits).',
    solutionJava:java(`public static void main(String[] args) throws IOException {
    String n = new BufferedReader(new InputStreamReader(System.in)).readLine().trim();
    int sum = 0;
    for (char ch : n.toCharArray()) sum += ch - '0';
    System.out.println(sum);
}`),solutionJS:js(`let n=BigInt(text.trim()),sum=0n;
while(n>0n){sum+=n%10n;n/=10n;}
console.log(String(sum));`)},cases,input=>[...input.trim()].reduce((s,d)=>s+Number(d),0),'Zero, a single digit, 10^18, all nines, or a random 64-bit value');
}
{
  const cases=['hello world from the arena\n','one\n','a b\n','be quick or be dead\n','x y z w v\n'];
  while(cases.length<TESTS-2)cases.push(Array.from({length:random(2,60)},()=>word(1,12)).join(' ')+'\n');
  cases.push(Array.from({length:1000},()=>word(1,20)).join(' ')+'\n',Array.from({length:1000},(_,i)=>'w'+i).join(' ')+'\n');
  add({slug:'blitz-reverse-words',title:'Reverse the Words',difficulty:'EASY',tags:['strings','blitz'],
    statement:'A sentence is a list of words separated by single spaces. Print its words in **reverse order**. The letters inside each word stay as they are.',
    inputFormat:'One line containing the words, separated by single spaces.',outputFormat:'Print the words in reverse order on one line, separated by single spaces.',
    constraints:'1 <= number of words <= 1000. Each word has 1 to 20 lowercase English letters or digits.',
    explanation:'Split on whitespace and print the list backwards. O(total length).',
    solutionJava:java(`${READ}
public static void main(String[] args) throws IOException {
    String[] w = tokens();
    StringBuilder out = new StringBuilder();
    for (int i = w.length - 1; i >= 0; --i) out.append(w[i]).append(i == 0 ? "\\n" : " ");
    System.out.print(out);
}`),solutionJS:js(`const w=text.trim().split(/\\s+/);const out=[];
for(let i=w.length-1;i>=0;i--)out.push(w[i]);
console.log(out.join(' '));`)},cases,input=>input.trim().split(' ').reverse().join(' '),'One word, two words, or up to 1000 words');
}
{
  const cases=[arrInput([3,9,4,9,7]),arrInput([5,5]),arrInput([-1,-2]),arrInput([1000000000,-1000000000]),arrInput([4,4,4,3]),
    arrInput([-5,-5,-5,-5]),arrInput(array(10,-3,3)),arrInput(array(1000)),arrInput(Array(20000).fill(7)),
    arrInput([...Array(19999).fill(1000000000),999999999]),arrInput(array(20000)),arrInput(array(20000,-2,2))];
  add({slug:'blitz-second-largest',title:'Second Largest Value',difficulty:'EASY',tags:['arrays','blitz'],
    statement:'Find the **second largest different value** in an array: the largest value that is strictly smaller than the maximum. If every element is equal, there is no such value.',
    inputFormat:'The first line contains n. The second line contains n integers.',
    outputFormat:'Print the second largest different value, or NONE if all elements are equal.',
    constraints:'2 <= n <= 20000; -10^9 <= ai <= 10^9.',
    explanation:'One pass keeping the largest and the largest value below it; equal values never become the second. O(n).',
    solutionJava:java(`${READ}
public static void main(String[] args) throws IOException {
    String[] t = tokens();
    int n = Integer.parseInt(t[0]);
    long first = Long.MIN_VALUE, second = Long.MIN_VALUE;
    for (int i = 1; i <= n; ++i) {
        long x = Long.parseLong(t[i]);
        if (x > first) { second = first; first = x; }
        else if (x < first && x > second) second = x;
    }
    System.out.println(second == Long.MIN_VALUE ? "NONE" : String.valueOf(second));
}`),solutionJS:js(`const a=text.trim().split(/\\s+/).slice(1).map(Number);
const max=a.reduce((m,x)=>x>m?x:m,-Infinity);let best=null;
for(const x of a)if(x<max&&(best===null||x>best))best=x;
console.log(best===null?'NONE':String(best));`)},cases,input=>{
      const v=[...new Set(input.trim().split(/\s+/).slice(1).map(Number))].sort((x,y)=>y-x);return v.length<2?'NONE':v[1];
    },'Duplicated maximum, all equal, negatives, extremes or maximum length');
}
{
  const runs=parts=>parts.flatMap(([v,k])=>Array(k).fill(v));
  const cases=[arrInput([1,1,2,2,2,1]),arrInput([5]),arrInput([1,2,3,4]),arrInput([7,7,7,7]),arrInput(runs([[1,3],[2,3],[1,4]])),
    arrInput([-1000000000,-1000000000,1000000000]),arrInput(array(50,0,1)),arrInput(array(1000,0,2)),
    arrInput(runs([[0,10000],[1,10000]])),arrInput([...array(19990,-1,1),...Array(10).fill(9)]),arrInput(Array(20000).fill(-3)),arrInput(array(20000))];
  add({slug:'blitz-longest-run',title:'Longest Run',difficulty:'EASY',tags:['arrays','implementation','blitz'],
    statement:'A **run** is a block of consecutive positions that all hold the same value. Find the length of the longest run in the array.',
    inputFormat:'The first line contains n. The second line contains n integers.',outputFormat:'Print the length of the longest run.',
    constraints:'1 <= n <= 20000; -10^9 <= ai <= 10^9.',
    explanation:'Scan once, extending the current run while the value repeats and resetting it otherwise. O(n).',
    solutionJava:java(`${READ}
public static void main(String[] args) throws IOException {
    String[] t = tokens();
    int n = Integer.parseInt(t[0]), best = 1, current = 1;
    for (int i = 2; i <= n; ++i) {
        current = t[i].equals(t[i - 1]) ? current + 1 : 1;
        best = Math.max(best, current);
    }
    System.out.println(best);
}`),solutionJS:js(`const a=text.trim().split(/\\s+/).slice(1).map(Number);let best=0;
for(let i=0;i<a.length;){let j=i;while(j<a.length&&a[j]===a[i])j++;best=Math.max(best,j-i);i=j;}
console.log(best);`)},cases,input=>{
      // Oracle: the longest gap between positions where the value changes.
      const a=input.trim().split(/\s+/).slice(1).map(Number),cuts=[0];
      for(let i=1;i<a.length;i++)if(a[i]!==a[i-1])cuts.push(i);
      cuts.push(a.length);
      return cuts.slice(1).reduce((best,c,i)=>Math.max(best,c-cuts[i]),0);
    },'Single element, no repeats, one long run at the start or end, or maximum length');
}
{
  const rot=(a,k)=>`${a.length} ${k}\n${a.join(' ')}\n`;
  const cases=[rot([1,2,3,4,5],2),rot([10,20,30],0),rot([4],1000000000),rot([1,2,3],3),rot([1,2,3],4),rot([-1,0,1],1000000000),
    rot(array(10,-9,9),7),rot(array(1000),999),rot(array(1000),random(0,1000000000)),rot(array(20000),1),
    rot(array(20000),19999),rot(array(20000),random(0,1000000000))];
  add({slug:'blitz-rotate-right',title:'Rotate Right',difficulty:'EASY',tags:['arrays','math','blitz'],
    statement:'Rotate an array **k** steps to the right: each step moves the last element to the front. Print the array after all k steps.',
    inputFormat:'The first line contains n and k. The second line contains n integers.',
    outputFormat:'Print the rotated array on one line, separated by spaces.',
    constraints:'1 <= n <= 20000; 0 <= k <= 10^9; -10^9 <= ai <= 10^9. Simulating every step is too slow for large k.',
    explanation:'Only k mod n matters. Element i moves to position (i + k) mod n. O(n).',
    solutionJava:java(`${READ}
public static void main(String[] args) throws IOException {
    String[] t = tokens();
    int n = Integer.parseInt(t[0]);
    int k = (int) (Long.parseLong(t[1]) % n);
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < n; ++i) out.append(t[2 + (i - k + n) % n]).append(i + 1 == n ? "\\n" : " ");
    System.out.print(out);
}`),solutionJS:js(`const t=text.trim().split(/\\s+/).map(Number),n=t[0],k=t[1]%n,a=t.slice(2),r=Array(n);
a.forEach((x,i)=>{r[(i+k)%n]=x;});
console.log(r.join(' '));`)},cases,input=>{
      const t=input.trim().split(/\s+/).map(Number),n=t[0],k=t[1]%n,a=t.slice(2);return [...a.slice(n-k),...a.slice(0,n-k)].join(' ');
    },'k = 0, k a multiple of n, k > n, k = 10^9, or maximum length');
}
{
  const cases=['6\n','1\n','2\n','27\n','97\n','871\n','1000000\n','837799\n','999999\n','77031\n',`${random(2,1000000)}\n`,`${random(2,1000000)}\n`];
  add({slug:'blitz-collatz-steps',title:'Collatz Steps',difficulty:'EASY',tags:['math','simulation','blitz'],
    statement:'Start from **n** and repeat: if the number is even, halve it; if it is odd, replace it by 3 times the number plus 1. Count the steps until the number becomes 1.',
    inputFormat:'One line with the integer n.',outputFormat:'Print the number of steps (0 when n = 1).',
    constraints:'1 <= n <= 10^6. Intermediate values can exceed 2^31, so use 64-bit integers.',
    explanation:'Simulate with a 64-bit value. The longest chain below 10^6 starts at 837799 (524 steps) and peaks near 5.7·10^10.',
    solutionJava:java(`public static void main(String[] args) throws IOException {
    long x = Long.parseLong(new BufferedReader(new InputStreamReader(System.in)).readLine().trim());
    int steps = 0;
    while (x != 1) { x = (x % 2 == 0) ? x / 2 : 3 * x + 1; ++steps; }
    System.out.println(steps);
}`),solutionJS:js(`let x=BigInt(text.trim()),steps=0;
while(x!==1n){x=x%2n===0n?x/2n:3n*x+1n;steps++;}
console.log(steps);`)},cases,input=>{let x=Number(input),s=0;while(x>1){x=x%2===1?3*x+1:x/2;s++;}return s;},'n = 1, small chains, 27, the longest chain under 10^6, or 64-bit peaks');
}
{
  const cases=['5\n','0\n','1\n','2\n','255\n','256\n','1000000000000000000\n','576460752303423487\n','1023\n',bigDigits(18)+'\n',bigDigits(9)+'\n',bigDigits(15)+'\n'];
  add({slug:'blitz-binary',title:'To Binary',difficulty:'EASY',tags:['math','bit-manipulation','blitz'],
    statement:'Write the non-negative integer **n** in base 2, without leading zeros. The number 0 is written as 0.',
    inputFormat:'One line with the integer n.',outputFormat:'Print n in binary.',
    constraints:'0 <= n <= 10^18. Use a 64-bit integer.',
    explanation:'Repeatedly take n mod 2 and divide by 2, then print the bits in reverse; or use a library conversion. O(log n).',
    solutionJava:java(`public static void main(String[] args) throws IOException {
    long n = Long.parseLong(new BufferedReader(new InputStreamReader(System.in)).readLine().trim());
    System.out.println(Long.toBinaryString(n));
}`),solutionJS:js(`let n=BigInt(text.trim());const bits=[];
do{bits.push(String(n%2n));n/=2n;}while(n>0n);
console.log(bits.reverse().join(''));`)},cases,input=>BigInt(input.trim()).toString(2),'Zero, one, powers of two and their neighbours, or 60-bit values');
}
{
  const cases=['aaabccdddd\n','z\n','abc\n','zzzzzzzzzz\n','aabbaa\n','abababab\n',word(50,50,'ab')+'\n',word(1000,1000,'xy')+'\n',
    'a'.repeat(20000)+'\n',Array.from({length:20},()=>'q'.repeat(random(1,400))+'r'.repeat(random(1,400))).join('')+'\n',
    word(20000,20000,'abc')+'\n',word(20000,20000)+'\n'];
  add({slug:'blitz-run-length',title:'Run-Length Encoding',difficulty:'EASY',tags:['strings','blitz'],
    statement:'Compress a string by replacing every block of equal consecutive letters with the letter followed by the block length. For example, **aaabccdddd** becomes **a3b1c2d4**.',
    inputFormat:'One line with a string of lowercase English letters.',outputFormat:'Print the encoded string.',
    constraints:'1 <= length <= 20000. A block can be longer than 9 letters.',
    explanation:'Scan once, count each block of equal letters and append letter + count. Build the output with a string builder. O(length).',
    solutionJava:java(`public static void main(String[] args) throws IOException {
    String s = new BufferedReader(new InputStreamReader(System.in)).readLine().trim();
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < s.length(); ) {
        int j = i;
        while (j < s.length() && s.charAt(j) == s.charAt(i)) ++j;
        out.append(s.charAt(i)).append(j - i);
        i = j;
    }
    System.out.println(out);
}`),solutionJS:js(`const s=text.trim();let out='',count=1;
for(let i=1;i<=s.length;i++){if(s[i]===s[i-1])count++;else{out+=s[i-1]+count;count=1;}}
console.log(out);`)},cases,input=>input.trim().replace(/([a-z])\1*/g,m=>m[0]+m.length),'Single letter, no repeats, blocks of 10 or more, or maximum length');
}

// ---------- MEDIUM ----------
{
  const cases=[arrInput([7,1,5,3,6,4]),arrInput([7,6,4,3,1]),arrInput([5]),arrInput([2,2,2]),arrInput([1,1000000000]),arrInput([1000000000,1]),
    arrInput(array(20,1,100)),arrInput(array(2000,1,1000000000)),arrInput(Array.from({length:20000},(_,i)=>20000-i)),
    arrInput([...array(19999,500000000,600000000),1000000000]),arrInput([1,...array(19999,1,1000000000)]),arrInput(array(100000,1,1000000000))];
  add({slug:'blitz-best-trade',title:'Best Single Trade',difficulty:'MEDIUM',tags:['arrays','greedy','blitz'],
    statement:'You know the price of a coin on each of n days. Buy it on one day and sell it on a **later** day to maximize the profit (sell price minus buy price). If no trade makes money, do not trade and earn 0.',
    inputFormat:'The first line contains n. The second line contains the n prices in day order.',
    outputFormat:'Print the maximum profit.',constraints:'1 <= n <= 100000; 1 <= price <= 10^9. Trying every pair of days is too slow.',
    explanation:'Scan left to right keeping the lowest price so far; the best sale today earns price - lowest. O(n).',
    solutionJava:java(`${READ}
public static void main(String[] args) throws IOException {
    String[] t = tokens();
    int n = Integer.parseInt(t[0]);
    long low = Long.MAX_VALUE, best = 0;
    for (int i = 1; i <= n; ++i) {
        long p = Long.parseLong(t[i]);
        best = Math.max(best, p - low);
        low = Math.min(low, p);
    }
    System.out.println(best);
}`),solutionJS:js(`const p=text.trim().split(/\\s+/).slice(1).map(Number);let low=Infinity,best=0;
for(const x of p){if(x-low>best)best=x-low;if(x<low)low=x;}
console.log(best);`)},cases,input=>{
      // Oracle: highest later price for each day, scanned from the right.
      const p=input.trim().split(/\s+/).slice(1).map(Number);let high=0,best=0;
      for(let i=p.length-1;i>=0;i--){best=Math.max(best,high-p[i]);high=Math.max(high,p[i]);}return best;
    },'One day, falling prices, flat prices, extremes, or maximum length');
}
{
  const cases=['10\n','0\n','1\n','2\n','3\n','100\n','1000000\n','999983\n','999982\n','65536\n',`${random(10,1000000)}\n`,`${random(10,1000000)}\n`];
  add({slug:'blitz-count-primes',title:'Count the Primes',difficulty:'MEDIUM',tags:['math','number-theory','sieve','blitz'],
    statement:'Count the prime numbers that are less than or equal to **n**. A prime is an integer greater than 1 whose only divisors are 1 and itself.',
    inputFormat:'One line with the integer n.',outputFormat:'Print the number of primes p with p <= n.',
    constraints:'0 <= n <= 10^6. Testing every number by trial division up to n is too slow in some languages; use a sieve.',
    explanation:'Sieve of Eratosthenes up to n: for every prime p, cross out p*p, p*p+p, ... Count what remains. O(n log log n).',
    solutionJava:java(`public static void main(String[] args) throws IOException {
    int n = Integer.parseInt(new BufferedReader(new InputStreamReader(System.in)).readLine().trim());
    boolean[] composite = new boolean[n + 1];
    int count = 0;
    for (int i = 2; i <= n; ++i) {
        if (composite[i]) continue;
        ++count;
        for (long j = (long) i * i; j <= n; j += i) composite[(int) j] = true;
    }
    System.out.println(count);
}`),solutionJS:js(`const n=Number(text.trim()),sieve=new Uint8Array(n+1);let count=0;
for(let i=2;i<=n;i++){if(sieve[i])continue;count++;for(let j=i*i;j<=n;j+=i)sieve[j]=1;}
console.log(count);`)},cases,input=>{
      // Oracle: trial division by the primes found so far, independent of any sieve.
      const n=Number(input),primes=[];
      for(let x=2;x<=n;x++){let prime=true;for(const p of primes){if(p*p>x)break;if(x%p===0){prime=false;break;}}if(prime)primes.push(x);}
      return primes.length;
    },'n = 0, 1, 2, a prime or its neighbour, a power of two, or 10^6');
}
{
  const cases=[arrInput([3,4,-1,1]),arrInput([1,2,0]),arrInput([7,8,9]),arrInput([1]),arrInput([-5]),arrInput([2,2,2,1,1]),
    arrInput(shuffle(Array.from({length:1000},(_,i)=>i+1))),arrInput([1000000000,-1000000000,1]),
    arrInput(shuffle(Array.from({length:20000},(_,i)=>i+1))),arrInput(shuffle([...Array.from({length:19999},(_,i)=>i+2),-7])),
    arrInput(array(20000,-5,20000)),arrInput(array(100000))];
  add({slug:'blitz-first-missing',title:'First Missing Positive',difficulty:'MEDIUM',tags:['arrays','hashing','blitz'],
    statement:'Find the **smallest positive integer** (1, 2, 3, ...) that does not appear in the array. Values can be negative, zero, repeated, or very large.',
    inputFormat:'The first line contains n. The second line contains n integers.',outputFormat:'Print the smallest positive integer missing from the array.',
    constraints:'1 <= n <= 100000; -10^9 <= ai <= 10^9.',
    explanation:'The answer is at most n + 1, so mark which of the values 1..n occur in a boolean array and return the first unmarked one. O(n).',
    solutionJava:java(`${READ}
public static void main(String[] args) throws IOException {
    String[] t = tokens();
    int n = Integer.parseInt(t[0]);
    boolean[] seen = new boolean[n + 2];
    for (int i = 1; i <= n; ++i) {
        long x = Long.parseLong(t[i]);
        if (x >= 1 && x <= n) seen[(int) x] = true;
    }
    int answer = 1;
    while (seen[answer]) ++answer;
    System.out.println(answer);
}`),solutionJS:js(`const a=text.trim().split(/\\s+/).slice(1).map(Number).filter(x=>x>0).sort((x,y)=>x-y);let answer=1;
for(const x of a){if(x===answer)answer++;else if(x>answer)break;}
console.log(answer);`)},cases,input=>{const s=new Set(input.trim().split(/\s+/).slice(1).map(Number));let x=1;while(s.has(x))x++;return x;},
    'Answer 1, answer n + 1, duplicates, negatives, or a full permutation');
}
{
  const pairs=(a,target)=>`${a.length} ${target}\n${a.join(' ')}\n`;
  const cases=[pairs([1,5,3,3,7,-1],6),pairs([2,2,2,2],4),pairs([1,2,3],100),pairs([5],10),pairs([0,0],0),pairs([-1000000000,1000000000],0),
    pairs(array(30,-5,5),0),pairs(array(2000,-50,50),random(-20,20)),pairs(Array(100000).fill(1),2),
    pairs(Array.from({length:20000},(_,i)=>i%2?1000000000:-1000000000),0),pairs(array(20000,-1000,1000),random(-100,100)),pairs(array(20000),0)];
  add({slug:'blitz-pair-sums',title:'Count Pair Sums',difficulty:'MEDIUM',tags:['arrays','hashing','counting','blitz'],
    statement:'Count the pairs of positions **i < j** with **a[i] + a[j] = target**. Two pairs are different if they use different positions, even when the values are the same.',
    inputFormat:'The first line contains n and target. The second line contains n integers.',outputFormat:'Print the number of pairs.',
    constraints:'1 <= n <= 100000; -10^9 <= ai <= 10^9; -2·10^9 <= target <= 2·10^9. The answer can reach about 5·10^9: use a 64-bit counter.',
    explanation:'Scan left to right with a hash map of how often each value appeared; each element adds the count of target - a[j] seen before it. O(n) expected.',
    solutionJava:java(`${READ}
public static void main(String[] args) throws IOException {
    String[] t = tokens();
    int n = Integer.parseInt(t[0]);
    long target = Long.parseLong(t[1]), pairs = 0;
    HashMap<Long, Integer> seen = new HashMap<>();
    for (int i = 0; i < n; ++i) {
        long x = Long.parseLong(t[2 + i]);
        pairs += seen.getOrDefault(target - x, 0);
        seen.merge(x, 1, Integer::sum);
    }
    System.out.println(pairs);
}`),solutionJS:js(`const t=text.trim().split(/\\s+/).map(Number),n=t[0],target=t[1],a=t.slice(2).sort((x,y)=>x-y);
// Two pointers over the sorted values, counting equal blocks together.
let i=0,j=n-1,pairs=0;
while(i<j){const s=a[i]+a[j];
  if(s<target)i++;else if(s>target)j--;
  else if(a[i]===a[j]){const k=j-i+1;pairs+=k*(k-1)/2;break;}
  else{let ci=1,cj=1;while(i+ci<j&&a[i+ci]===a[i])ci++;while(j-cj>i&&a[j-cj]===a[j])cj++;pairs+=ci*cj;i+=ci;j-=cj;}}
console.log(pairs);`)},cases,input=>{
      // Oracle: brute force on small inputs, value frequencies on large ones.
      const t=input.trim().split(/\s+/).map(Number),n=t[0],target=t[1],a=t.slice(2);
      if(n<=3000){let c=0;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(a[i]+a[j]===target)c++;return c;}
      const f=new Map();for(const x of a)f.set(x,(f.get(x)??0)+1);let c=0;
      for(const [v,k] of f){const w=target-v;if(w===v)c+=k*(k-1);else c+=k*(f.get(w)??0);}return c/2;
    },'No pair, equal values, signed extremes, or a 64-bit answer');
}

function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=random(0,i);[a[i],a[j]]=[a[j],a[i]];}return a;}

for(const p of problems) {
  const dir=path.join(root,p.slug);
  fs.rmSync(dir,{recursive:true,force:true});
  fs.mkdirSync(path.join(dir,'tests'),{recursive:true});
  const metadata={...p,referenceLanguage:'JAVA',referenceFile:'Main.java',independentReferenceFile:'solution.js',
    source:'Original InfoM4th blitz problem',
    tests:p.tests.map((t,i)=>({input:`tests/${String(i+1).padStart(2,'0')}.in`,expected:`tests/${String(i+1).padStart(2,'0')}.out`,sample:i<2,purpose:i<2?'Example':t.purpose}))};
  delete metadata.solutionJava;delete metadata.solutionJS;
  fs.writeFileSync(path.join(dir,'problem.json'),JSON.stringify(metadata,null,2)+'\n');
  fs.writeFileSync(path.join(dir,'Main.java'),p.solutionJava);
  fs.writeFileSync(path.join(dir,'solution.js'),p.solutionJS);
  for(const [i,t] of p.tests.entries()) {
    const stem=String(i+1).padStart(2,'0');
    fs.writeFileSync(path.join(dir,'tests',stem+'.in'),t.input);
    fs.writeFileSync(path.join(dir,'tests',stem+'.out'),t.expected);
  }
}
fs.writeFileSync(path.join(root,'index.json'),JSON.stringify(problems.map(p=>p.slug),null,2)+'\n');
const table=problems.map(p=>`| ${p.title} | ${p.difficulty} | ${p.tags.filter(t=>t!=='blitz').join(', ')} | ${p.statement.replace(/\*\*/g,'').split('. ')[0]}. |`).join('\n');
fs.writeFileSync(path.join(root,'README.md'),`# Duel problem bank

${problems.length} short problems for duels, ${problems.length*TESTS} tests: 2 examples and ${TESTS-2} hidden tests each, so verdicts come back fast.
Reference solutions are Java (\`Main.java\`), with an independent Node.js check (\`solution.js\`).

| Problem | Level | Topics | Task |
| --- | --- | --- | --- |
${table}

## Regenerate, verify, package

Run from the repository root:

\`\`\`text
node examples/duel-problems/generate.mjs
node examples/duel-problems/verify.mjs
node scripts/package-problem-bank.mjs examples/duel-problems backend/src/main/resources/seed/duel-problems.json
\`\`\`

The backend bundles \`seed/duel-problems.json.gz\` (only the \`.gz\` is committed) and installs every problem
by itself: import, validate the reference on the judge, approve, add to the duel pool. It retries every
20 seconds until a judge for every language (C, C++, Java, Python) is online, and never imports a short
name twice. Problems added here reach a running server with its next deployment. Set
\`CP_SEED_DUEL_PROBLEMS=false\` to turn this off.

To install the bank by hand instead, package it to \`examples/duel-problems/problem-bank.import.json\` and use
**Control room -> Duel problems -> Bulk import duel problems** ("Validate, approve and add to Duels").
`);
console.log(`Wrote ${problems.length} problems, ${problems.length*TESTS} tests.`);
