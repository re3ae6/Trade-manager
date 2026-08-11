export function formatNumber(value){
  return Number(value || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
}

export function money(value){
  const negative = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  return negative + '$' + formatted;
}

export function formatDateTime(d){
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function csvEscape(value){
  let s = String(value);
  if(/^[=+\-@]/.test(s)) s = '\t' + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}
