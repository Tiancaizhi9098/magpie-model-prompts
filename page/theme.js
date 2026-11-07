// Small theme-only implementation of Magpie's documented page bridge protocol.
// Prompt content never goes through the bridge or the parent window.
(() => {
  let finish,fail;
  const ready=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
  function paint(theme){
    const root=document.documentElement;root.dataset.theme=theme.dark?'dark':'light';root.style.colorScheme=theme.dark?'dark':'light';root.lang=theme.lang||'zh-CN';
    for(const [key,value]of Object.entries(theme.tokens||{}))root.style.setProperty('--magpie-'+key,value);
  }
  addEventListener('message',event=>{
    if(event.source!==parent||event.data?.magpie!==1)return;
    const message=event.data;
    if(message.event==='theme'){paint(message.data);return;}
    if(message.id!==1)return;
    if(message.error)fail(new Error(message.error));else{paint(message.result);finish(message.result);}
  });
  window.magpie={ready};
  parent.postMessage({magpie:1,id:1,method:'hello'},'*');
})();
