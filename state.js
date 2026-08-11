export const STORAGE_KEY = 'masaniello_calc_state_v1';
export const CURRENT_STATE_VERSION = 2;

function migrateState(state){
  if(!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const version = Number.isInteger(state.version) ? state.version : 1;
  if(version > CURRENT_STATE_VERSION) return null;
  let migrated = {...state};
  if(version === 1){
    migrated = {...migrated, version: 2};
  }
  return migrated;
}

export function readStoredState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    const state = migrateState(JSON.parse(raw));
    if(!state){
      console.error('[Trade Manager] Saved state is invalid or from a newer unsupported version.');
      return null;
    }
    return state;
  }catch(error){
    console.error('[Trade Manager] Failed to read saved state.', error);
    return null;
  }
}

export function writeStoredState(state){
  try{
    const payload = {...state, version: CURRENT_STATE_VERSION};
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  }catch(error){
    console.error('[Trade Manager] Failed to persist state.', error);
    return false;
  }
}
