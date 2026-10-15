'use client';
import {useEffect,useState,useCallback} from 'react';
import {apiFetch,isAbortError,invalidatePublicApi,publicApiSnapshot} from './api';
/** Preserve last successfully loaded PUBLIC content on a transient refresh failure. */
export function usePublicResource<T=any>(path:string,field:string){
 const [revision,setRevision]=useState(0);
 const [state,setState]=useState<{path:string;data:T[];loading:boolean;loaded:boolean;error:string}>(()=>({path,data:[],loading:true,loaded:false,error:''}));
 const retry=useCallback(()=>{invalidatePublicApi();setRevision(x=>x+1);},[]);
 useEffect(()=>{
  const controller=new AbortController();
  const cached=publicApiSnapshot(path);if(Array.isArray(cached?.[field]))setState({path,data:cached[field],loading:false,loaded:true,error:''});
  setState(old=>old.path===path?{...old,loading:!old.loaded,error:''}:{path,data:[],loading:true,loaded:false,error:''});
  apiFetch(path,{signal:controller.signal}).then(d=>{if(!Array.isArray(d[field]))throw new Error('The service returned incomplete content. Please retry.');if(!controller.signal.aborted)setState({path,data:d[field],loading:false,loaded:true,error:''});}).catch(e=>{if(!isAbortError(e)&&!controller.signal.aborted)setState(old=>({...old,path,loading:false,error:e.message||'Unable to load content.'}));});
  return()=>controller.abort();
 },[path,field,revision]);
 useEffect(()=>{const focused=()=>{if(document.visibilityState==='visible'&&navigator.onLine)setRevision(x=>x+1);};const timer=setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine)setRevision(x=>x+1);},30000);document.addEventListener('visibilitychange',focused);window.addEventListener('online',focused);window.addEventListener('focus',focused);window.addEventListener('sa-website-content',retry);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',focused);window.removeEventListener('online',focused);window.removeEventListener('focus',focused);window.removeEventListener('sa-website-content',retry);};},[retry]);
 return {...state,retry};
}
