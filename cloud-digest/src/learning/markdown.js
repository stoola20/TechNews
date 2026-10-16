import {marked} from 'marked';
import sanitizeHtml from 'sanitize-html';

// Some older model responses escaped every newline twice. Only repair prose
// in that recognizable case; literal escapes inside code must survive.
export function normalizeMarkdown(value) {
  if(typeof value!=='string')return '';
  if(value.includes('\n')||!value.includes('\\n\\n'))return value;
  const code=[];
  const protectedText=value.replace(/(`{3,}|~{3,})[\s\S]*?\1|(`+)[^`]*?\2/g,match=>{
    code.push(match);return `\u0000CODE${code.length-1}\u0000`;
  });
  if(!protectedText.includes('\\n\\n'))return value;
  return protectedText.replace(/\\r\\n|\\n/g,'\n').replace(/\u0000CODE(\d+)\u0000/g,(_,index)=>code[Number(index)]);
}

export function renderMarkdown(value) {
  return sanitizeHtml(marked.parse(normalizeMarkdown(value),{async:false,gfm:true}),{
    allowedTags:['p','br','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','strong','em','del','hr','table','thead','tbody','tr','th','td','a'],
    allowedAttributes:{a:['href','title','target','rel'],code:['class'],ol:['start'],th:['align'],td:['align']},
    allowedSchemes:['https','http','mailto'],allowProtocolRelative:false,
    transformTags:{a:(tagName,attribs)=>({tagName,attribs:{...attribs,target:'_blank',rel:'noopener noreferrer'}})},
  });
}
