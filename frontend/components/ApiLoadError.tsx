'use client';
export default function ApiLoadError({message,onRetry,busy=false}:{message:string;onRetry:()=>void;busy?:boolean}){
 return <div className="emptyState" role="alert"><b>Unable to load this content right now.</b><p>{message}</p><button type="button" className="pill" disabled={busy} onClick={onRetry}>{busy?'Retrying…':'Retry'}</button></div>;
}
