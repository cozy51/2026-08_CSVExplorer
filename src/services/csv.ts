import type { CellValue, ColumnDefinition, ColumnType, DataRow } from '../models/dataset';

export function detectDelimiter(text: string) {
  const sample = text.split(/\r?\n/).slice(0, 8).join('\n');
  return [',', '\t', ';', '|'].map(delimiter => ({ delimiter, count: parseCsv(sample, delimiter)[0]?.length ?? 0 })).sort((a,b)=>b.count-a.count)[0].delimiter;
}
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
  for (let i=0;i<text.length;i++) { const c=text[i];
    if (c==='"') { if (quoted && text[i+1]==='"') { value+='"'; i++; } else quoted=!quoted; }
    else if (c===delimiter && !quoted) { row.push(value); value=''; }
    else if ((c==='\n'||c==='\r') && !quoted) { if(c==='\r'&&text[i+1]==='\n') i++; row.push(value); if(row.some(v=>v.trim()!=='')) rows.push(row); row=[]; value=''; }
    else value+=c;
  }
  row.push(value); if(row.some(v=>v.trim()!=='')) rows.push(row); return rows;
}
const bools = new Map([['true',true],['false',false],['on',true],['off',false],['yes',true],['no',false]]);
export function inferType(values: string[], name=''): ColumnType {
  const v=values.map(x=>x.trim()).filter(Boolean); if(!v.length) return 'text';
  if (v.every(x=>/^(?:0|1|true|false|on|off|yes|no)$/i.test(x)) && new Set(v.map(x=>x.toLowerCase())).size<=2) return 'boolean';
  if(v.every(x=>/^0x[\da-f]+$/i.test(x))) return 'code';
  if(v.every(x=>Number.isFinite(Number(x)))) return 'number';
  if(/date|time|timestamp|日時|時刻|時間/i.test(name) && v.filter(x=>!Number.isNaN(Date.parse(x))).length/v.length>.7) return 'datetime';
  if(new Set(v).size<=Math.min(30,Math.max(5,v.length*.2))) return 'category'; return 'text';
}
export function convert(raw:string, type:ColumnType):CellValue { const s=raw.trim(); if(!s)return null; if(type==='number')return Number(s); if(type==='boolean'){ const x=s.toLowerCase(); return bools.has(x)?bools.get(x)!:Number(s)!==0;} return s; }
export function defineColumns(headers:string[], rawRows:string[][], groups:string[]=[]):ColumnDefinition[]{
  const seen=new Map<string,number>(); return headers.map((header,i)=>{const base=header.trim()||`Column ${i+1}`; const n=seen.get(base)||0; seen.set(base,n+1); const name=n?`${base} (${n+1})`:base; const vals=rawRows.map(r=>r[i]??''); const type=inferType(vals,name); const parsed=vals.map(v=>convert(v,type)); const populated=parsed.filter(v=>v!==null); let changes=0; for(let j=1;j<parsed.length;j++)if(parsed[j]!==parsed[j-1])changes++;
    const nums=populated.filter((v):v is number=>typeof v==='number'); return {id:`c${i}`,name,group:groups[i]?.trim()||undefined,type,stats:{changes,missing:parsed.length-populated.length,unique:new Set(populated).size,...(nums.length?{min:Math.min(...nums),max:Math.max(...nums),average:nums.reduce((a,b)=>a+b,0)/nums.length}:{})}};});
}
export function toRows(raw:string[][], columns:ColumnDefinition[]):DataRow[]{return raw.map(r=>Object.fromEntries(columns.map((c,i)=>[c.id,convert(r[i]??'',c.type)])));}
