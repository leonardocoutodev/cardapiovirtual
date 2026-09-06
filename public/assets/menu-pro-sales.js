(()=>{
  const params=new URLSearchParams(location.search);
  let sid;
  try{
    sid=localStorage.getItem("lc_menu_sid");
    if(!sid){sid=crypto.randomUUID();localStorage.setItem("lc_menu_sid",sid)}
  }catch{sid=crypto.randomUUID()}

  const send=(eventName,metadata={})=>{
    fetch("/lcai/v1/eduzz/menu-pro/event",{
      method:"POST",
      headers:{"content-type":"application/json"},
      keepalive:true,
      body:JSON.stringify({
        event_name:eventName,
        session_id:sid,
        path:location.pathname,
        referrer:document.referrer,
        utm_source:params.get("utm_source"),
        utm_medium:params.get("utm_medium"),
        utm_campaign:params.get("utm_campaign"),
        utm_content:params.get("utm_content"),
        utm_term:params.get("utm_term"),
        metadata
      })
    }).catch(()=>{});
  };

  send("view_sales_page",{version:"sales_v9"});

  document.querySelectorAll("[data-track]").forEach(el=>{
    el.addEventListener("click",()=>{
      send(el.dataset.track||"item_click",{
        placement:el.dataset.placement||"unknown",
        label:(el.textContent||"").trim().slice(0,120)
      });
    },{passive:true});
  });

  const sent=new Set();
  const thresholds=[25,50,75,90];
  const trackScroll=()=>{
    const max=document.documentElement.scrollHeight-innerHeight;
    if(max<=0)return;
    const pct=Math.round((scrollY/max)*100);
    thresholds.forEach(value=>{
      if(pct>=value&&!sent.has(value)){
        sent.add(value);
        send("scroll_"+value,{threshold:value});
      }
    });
  };
  addEventListener("scroll",trackScroll,{passive:true});
  trackScroll();

  document.querySelectorAll(".faq details").forEach((item,index)=>{
    item.addEventListener("toggle",()=>{
      if(item.open)send("faq_open",{placement:"faq",label:(item.querySelector("summary")?.textContent||"FAQ "+(index+1)).trim().slice(0,120)});
    });
  });

  const frame=document.querySelector("[data-demo-frame]");
  const loadDemo=()=>{
    if(!frame||frame.getAttribute("src"))return;
    const src=frame.getAttribute("data-src");
    if(!src)return;
    frame.addEventListener("load",()=>send("live_demo_loaded",{placement:"hero"}),{once:true});
    frame.setAttribute("src",src);
  };
  if(frame){
    if("requestIdleCallback" in window)requestIdleCallback(loadDemo,{timeout:1200});
    else setTimeout(loadDemo,650);
  }
})();