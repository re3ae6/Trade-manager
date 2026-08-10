export const STORAGE_KEY = 'masaniello_calc_state_v1';

export function readStoredState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(_){ return null; }
}

export function writeStoredState(state){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  }catch(_){ return false; }
}
