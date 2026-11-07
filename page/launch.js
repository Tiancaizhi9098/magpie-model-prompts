(async()=>{
  await magpie.ready;
  const status=document.getElementById('connection-status');
  const load=()=>new Promise(resolve=>{const script=document.createElement('script');script.src='launch.generated.js?t='+Date.now();script.onload=()=>{script.remove();resolve(true);};script.onerror=()=>{script.remove();resolve(false);};document.head.append(script);});
  // Give the host time to finish starting its loopback service.
  await new Promise(resolve=>setTimeout(resolve,1200));
  for(let n=0;n<12;n++) {
    if(await load()) {
      const service=window.MODEL_PROMPT_SERVICE;
      if(service?.base&&service?.token){location.replace(service.base+'/editor.html#'+encodeURIComponent(service.token));return;}
    }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  status.textContent='本机编辑服务未能启动。请在 Magpie 的已安装插件中停用后重新启用本插件。';
})().catch(()=>{document.getElementById('connection-status').textContent='无法连接 Magpie，请重新打开插件页面。';});
