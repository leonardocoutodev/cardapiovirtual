(()=>{
"use strict";
const root=document.body;
const SLUG=root.dataset.menuSlug||"";
const IS_DEMO=root.dataset.menuDemo==="1";
const EMBED=root.dataset.menuEmbed==="1";
const TRACK_PARAMS=new URLSearchParams(location.search);
const CART_KEY="lc_menu_cart_"+SLUG;
const CART_TTL=6*60*60*1000;
let WHATS="",business=null,products=[],cats=["Todos"],active="Todos",selected=null,qty=1,cart=[];
let lastFocus=null,formStarted=false,previewUrl="",pendingRecommendation=null;
const $=id=>document.getElementById(id);
const money=n=>Number(n||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const escapeHtml=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const PRODUCT_PLACEHOLDER="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='188' height='168' viewBox='0 0 188 168'%3E%3Crect width='188' height='168' fill='%23eee7df'/%3E%3Cpath d='M55 104l25-27 22 22 15-16 27 31H55z' fill='%23c8beb5'/%3E%3C/svg%3E";
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const allAddons=p=>{
  if(Array.isArray(p?.addon_groups)&&p.addon_groups.length)return p.addon_groups.flatMap(g=>Array.isArray(g.options)?g.options:[]);
  return Array.isArray(p?.addons)?p.addons.map((a,i)=>Array.isArray(a)?{id:"legacy-"+i,name:String(a[0]||""),price:Number(a[1]||0)}:a):[];
};
const addonGroups=p=>{
  if(Array.isArray(p?.addon_groups)&&p.addon_groups.length)return p.addon_groups;
  const legacy=allAddons(p);
  return legacy.length?[{id:"legacy",name:"Adicionais",selection_type:"multiple",min_select:0,max_select:null,options:legacy}]:[];
};

const productById=id=>products.find(p=>String(p.id)===String(id));
const cartProductIds=()=>new Set(cart.map(i=>String(i.product.id)));
function explicitRecommendations(source){
  const refs=Array.isArray(source?.recommendations)?source.recommendations:[];
  return refs.map(ref=>({product:productById(ref.product_id),label:ref.label||null,manual:true}))
    .filter(x=>x.product&&x.product.available!==false);
}
function autoRecommendations(source){
  if(!source)return[];
  const text=norm([source.cat,source.name,...(Array.isArray(source.tags)?source.tags:[])].join(" "));
  const priority=[];
  if(/burger|burguer|hamburg|lanche|pizza|combo|prato|massa|porcao|porcao/.test(text)){
    priority.push(/bebida|refrigerante|refri|suco|agua|drink/);
    priority.push(/porcao|frita|acompanh/);
    priority.push(/sobremesa|doce|dessert|milk/);
  }else if(/bebida|refrigerante|refri|suco|agua|drink/.test(text)){
    priority.push(/sobremesa|doce|dessert|milk/);
    priority.push(/burger|burguer|lanche|pizza|combo|prato/);
  }else if(/sobremesa|doce|dessert|milk/.test(text)){
    priority.push(/bebida|refrigerante|refri|suco|cafe|drink/);
  }else if(/porcao|frita|acompanh/.test(text)){
    priority.push(/bebida|refrigerante|refri|suco|drink/);
    priority.push(/burger|burguer|lanche|combo/);
  }
  const candidates=products.filter(p=>p.available!==false&&String(p.id)!==String(source.id));
  const result=[];
  for(const pattern of priority){
    for(const p of candidates){
      if(result.some(x=>x.product.id===p.id))continue;
      if(pattern.test(norm([p.cat,p.name,...(Array.isArray(p.tags)?p.tags:[])].join(" "))))result.push({product:p,label:null,manual:false});
    }
  }
  if(result.length<3){
    for(const p of candidates.filter(p=>p.featured||p.cat!==source.cat)){
      if(!result.some(x=>x.product.id===p.id))result.push({product:p,label:null,manual:false});
      if(result.length>=3)break;
    }
  }
  return result;
}
function recommendationsFor(source,limit=3){
  const inCart=cartProductIds();
  const manual=explicitRecommendations(source);
  const base=manual.length?manual:autoRecommendations(source);
  return base.filter(x=>!inCart.has(String(x.product.id))).slice(0,limit);
}
function requiresConfiguration(product){
  return addonGroups(product).some(g=>Number(g.min_select||0)>0)||(allAddons(product).length>0);
}
function recommendationCard(entry,sourceId,placement){
  const p=entry.product;
  const label=entry.label||"Combina com seu pedido";
  const action=requiresConfiguration(p)?"Ver opções":"Adicionar";
  return '<article class="recommend-card">'
    +'<img src="'+escapeHtml(p.img||PRODUCT_PLACEHOLDER)+'" alt="'+escapeHtml(p.image_alt||p.name)+'" loading="lazy" decoding="async" width="132" height="132">'
    +'<div class="recommend-copy"><small>'+escapeHtml(label)+'</small><b>'+escapeHtml(p.name)+'</b><span>'+money(p.price)+'</span></div>'
    +'<button type="button" class="recommend-add" data-recommend-product="'+escapeHtml(p.id)+'" data-recommend-source="'+escapeHtml(sourceId)+'" data-recommend-placement="'+escapeHtml(placement)+'">'+action+'</button>'
    +'</article>';
}
function bindRecommendationButtons(container){
  if(!container)return;
  container.querySelectorAll("[data-recommend-product]").forEach(btn=>btn.onclick=()=>{
    const product=productById(btn.dataset.recommendProduct);
    if(!product)return;
    const sourceId=btn.dataset.recommendSource||"";
    const placement=btn.dataset.recommendPlacement||"unknown";
    if(requiresConfiguration(product)){
      closeModal("upsellModal");
      if(document.getElementById("cartModal")?.classList.contains("open"))closeModal("cartModal");
      track("recommendation_open",{business_slug:SLUG,source_product_id:sourceId,recommended_product_id:product.id,placement});
      openProduct(product.id,{source_product_id:sourceId,recommended_product_id:product.id,placement});
      return;
    }
    cart.push({id:crypto.randomUUID(),product,qty:1,addons:[],notes:""});
    updateCartBar();saveCart();announce(product.name+" adicionado");
    track("recommendation_add",{business_slug:SLUG,source_product_id:sourceId,recommended_product_id:product.id,placement});
    if(document.getElementById("cartModal")?.classList.contains("open"))renderCart();
    if(document.getElementById("upsellModal")?.classList.contains("open")){
      const source=productById(sourceId);showUpsell(source,true);
    }
  });
}
function showUpsell(source,refresh=false){
  const entries=recommendationsFor(source,3);
  if(!entries.length){if(refresh)closeModal("upsellModal");return}
  $("upsellSource").textContent=source?.name||"seu item";
  $("upsellList").innerHTML=entries.map(e=>recommendationCard(e,source.id,"after_add")).join("");
  bindRecommendationButtons($("upsellList"));
  if(!refresh)openModal("upsellModal","upsellNoThanks");
  track("recommendation_view",{business_slug:SLUG,source_product_id:source.id,items:entries.length,placement:"after_add"});
}
function cartRecommendationEntries(){
  const used=new Set(),out=[];
  for(const item of cart){
    for(const entry of recommendationsFor(item.product,3)){
      if(used.has(String(entry.product.id)))continue;
      used.add(String(entry.product.id));
      out.push({entry,sourceId:item.product.id});
      if(out.length>=4)return out;
    }
  }
  return out;
}
function renderCartRecommendations(){
  const host=$("cartRecommendations");if(!host)return;
  const entries=cartRecommendationEntries();
  if(!entries.length){host.hidden=true;host.innerHTML="";return}
  host.hidden=false;
  host.innerHTML='<div class="recommend-head"><div><small>Complete seu pedido</small><h3>Talvez você também queira</h3></div></div><div class="recommend-list">'
    +entries.map(x=>recommendationCard(x.entry,x.sourceId,"cart")).join("")+'</div>';
  bindRecommendationButtons(host);
  track("recommendation_view",{business_slug:SLUG,items:entries.length,placement:"cart"});
}

async function boot(){
  try{
    const r=await fetch("/lcai/v1/menu-pro/catalog/"+encodeURIComponent(SLUG),{headers:{accept:"application/json"}});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"Cardápio indisponível");
    business=d.business||{};
    products=Array.isArray(d.products)?d.products:[];
    cats=Array.isArray(d.cats)&&d.cats.length?d.cats:["Todos"];
    WHATS=business.order_whatsapp?"https://wa.me/"+business.order_whatsapp:"";
    applyBusiness();
    restoreCart();
    renderCats();
    renderProducts();
    updateCartBar();
    track(IS_DEMO?"view_demo":"menu_view",{version:"dynamic_v2",business_slug:SLUG,products:products.length,embed:EMBED});
  }catch(e){
    $("catalog").innerHTML='<div class="empty" style="display:block">Não foi possível carregar este cardápio agora.</div>';
    $("cartbar").style.display="none";
  }
}

function applyBusiness(){
  document.title=(business.name||"Cardápio")+" — LC Menu Pro";
  $("businessName").textContent=business.name||"Cardápio";
  $("businessSubtitle").textContent=[business.subtitle,business.city].filter(Boolean).join(" · ");
  const brand=$("brandmark");
  brand.innerHTML="";
  if(business.logo_url){
    const img=document.createElement("img");
    img.src=business.logo_url;img.alt="Logo "+(business.name||"do estabelecimento");img.width=58;img.height=58;img.decoding="async";
    brand.appendChild(img);
  }else{
    brand.textContent=business.brand_initials||String(business.name||"LC").split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();
  }
  if(business.accent){
    document.documentElement.style.setProperty("--accent",business.accent);
    document.documentElement.style.setProperty("--accentText",contrastText(business.accent));
  }
  if(business.cover_image_url){
    const img=$("coverImg");img.src=business.cover_image_url;img.alt="Capa de "+(business.name||"estabelecimento");
  }
  const badges=[];
  if(business.business_hours)badges.push('<span class="badge open">● '+escapeHtml(business.business_hours)+'</span>');
  if(business.eta)badges.push('<span class="badge">'+escapeHtml(business.eta)+'</span>');
  if(business.service_modes?.length)badges.push('<span class="badge">'+escapeHtml(business.service_modes.join(" e "))+'</span>');
  if(business.minimum_order)badges.push('<span class="badge">Pedido mínimo '+money(business.minimum_order)+'</span>');
  $("businessMeta").innerHTML=badges.join("");
  $("fulfillment").innerHTML=(business.service_modes?.length?business.service_modes:["Entrega","Retirada"]).map(x=>'<option>'+escapeHtml(x)+'</option>').join("");
  $("payment").innerHTML=(business.payment_methods?.length?business.payment_methods:["Pix","Cartão na entrega","Dinheiro"]).map(x=>'<option>'+escapeHtml(x)+'</option>').join("");
  updateSummary();updatePayment();
}

function contrastText(hex){
  const m=/^#([0-9a-f]{6})$/i.exec(hex||"");if(!m)return"#fff";
  const n=parseInt(m[1],16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  return ((r*299+g*587+b*114)/1000)>160?"#1b120b":"#fff";
}

function renderCats(){
  $("cats").innerHTML=cats.map(c=>'<button class="cat '+(active===c?'active':'')+'" type="button" data-cat="'+escapeHtml(c)+'">'+escapeHtml(c)+'</button>').join("");
  document.querySelectorAll(".cat").forEach(b=>b.onclick=()=>{
    active=b.dataset.cat||"Todos";renderCats();renderProducts();
    track("menu_category",{business_slug:SLUG,category:active,demo:IS_DEMO});
  });
}

function renderProducts(){
  const q=$("search").value.trim().toLowerCase();
  const list=products.filter(p=>(active==="Todos"||p.cat===active)&&(!q||(String(p.name)+" "+String(p.desc||"")).toLowerCase().includes(q)));
  $("catalog").innerHTML=list.map(p=>'<button class="product '+(p.available?"":"unavailable")+'" type="button" data-product-id="'+escapeHtml(p.id)+'" '+(p.available?"":"disabled")+' aria-label="'+(p.available?"Abrir ":"Indisponível: ")+escapeHtml(p.name)+'">'
    +'<img src="'+escapeHtml(p.img||PRODUCT_PLACEHOLDER)+'" alt="'+escapeHtml(p.image_alt||p.name)+'" loading="lazy" decoding="async" width="188" height="168">'
    +'<span><h3>'+escapeHtml(p.name)+'</h3><p>'+escapeHtml(p.desc||"")+'</p><span class="price">'+money(p.price)+'</span>'+(p.available?"":'<span class="sold">Esgotado</span>')+'</span>'
    +'<span class="add" aria-hidden="true">+</span></button>').join("");
  $("empty").style.display=list.length?"none":"block";
  document.querySelectorAll("[data-product-id]:not(:disabled)").forEach(b=>b.onclick=()=>openProduct(b.dataset.productId,null));
}

function openProduct(id,recommendationContext=null){
  pendingRecommendation=recommendationContext;
  selected=products.find(p=>String(p.id)===String(id));if(!selected||selected.available===false)return;
  qty=1;
  $("sheetImg").src=selected.img||"";$("sheetImg").alt=selected.image_alt||selected.name;
  $("sheetName").textContent=selected.name;$("sheetDesc").textContent=selected.desc||"";$("sheetPrice").textContent=money(selected.price);$("qty").textContent=String(qty);$("notes").value="";
  renderAddonGroups();
  openModal("productModal","closeProduct");
  track(IS_DEMO?"demo_open_product":"menu_open_product",{product_id:selected.id,product:selected.name,business_slug:SLUG});
}

function renderAddonGroups(){
  const groups=addonGroups(selected);
  $("addons").innerHTML=groups.length?groups.map(group=>{
    const type=group.selection_type==="single"?"radio":"checkbox";
    const min=Number(group.min_select||0),max=group.max_select==null?null:Number(group.max_select);
    const rule=min>0&&max===1?"Obrigatório · escolha 1":min>0?"Escolha pelo menos "+min:max?("Escolha até "+max):"Opcional";
    return '<section class="addon-group" data-group="'+escapeHtml(group.id||group.name)+'" data-min="'+min+'" data-max="'+(max==null?"":max)+'">'
      +'<div class="addon-group-head"><strong>'+escapeHtml(group.name||"Adicionais")+'</strong><small>'+escapeHtml(rule)+'</small></div>'
      +(group.options||[]).map(a=>'<div class="option"><label><input type="'+type+'" name="addon-'+escapeHtml(group.id||group.name)+'" value="'+escapeHtml(a.id)+'" data-addon-id="'+escapeHtml(a.id)+'"> '+escapeHtml(a.name)+'</label><b>'+(Number(a.price||0)>0?"+"+money(a.price):"Incluído")+'</b></div>').join("")
      +'</section>';
  }).join(""):'<p>Este item não possui adicionais.</p>';
  document.querySelectorAll("[data-addon-id]").forEach(input=>input.addEventListener("change",()=>{enforceGroupMax(input);track("addon_select",{business_slug:SLUG,product_id:selected?.id||"",demo:IS_DEMO})}));
}

function enforceGroupMax(input){
  const group=input.closest(".addon-group");if(!group)return;
  const max=Number(group.dataset.max||0);if(!max||input.type==="radio")return;
  const checked=[...group.querySelectorAll("input:checked")];
  if(checked.length>max){input.checked=false;announce("Você pode escolher até "+max+" opção"+(max===1?"":"ões")+" neste grupo.");}
}

function selectedAddons(){
  const ids=[...document.querySelectorAll("[data-addon-id]:checked")].map(x=>String(x.dataset.addonId));
  const map=new Map(allAddons(selected).map(a=>[String(a.id),a]));
  return ids.map(id=>map.get(id)).filter(Boolean);
}

function validateAddonGroups(){
  for(const group of document.querySelectorAll(".addon-group")){
    const min=Number(group.dataset.min||0),max=Number(group.dataset.max||0);
    const count=group.querySelectorAll("input:checked").length;
    if(count<min){announce("Escolha pelo menos "+min+" opção"+(min===1?"":"ões")+" em "+(group.querySelector("strong")?.textContent||"adicionais")+".");return false}
    if(max&&count>max){announce("Escolha no máximo "+max+" opção"+(max===1?"":"ões")+".");return false}
  }
  return true;
}

$("minus").onclick=()=>{qty=Math.max(1,qty-1);$("qty").textContent=String(qty)};
$("plus").onclick=()=>{qty++;$("qty").textContent=String(qty)};
$("addToCart").onclick=()=>{
  if(!validateAddonGroups())return;
  const source=selected,context=pendingRecommendation;
  const adds=selectedAddons();
  cart.push({id:crypto.randomUUID(),product:source,qty,addons:adds,notes:$("notes").value.trim()});
  pendingRecommendation=null;
  closeModal("productModal");updateCartBar();saveCart();announce("Adicionado ao pedido");
  track(IS_DEMO?"demo_add_cart":"menu_add_cart",{product_id:source.id,product:source.name,qty,business_slug:SLUG});
  if(context){
    track("recommendation_add",{business_slug:SLUG,source_product_id:context.source_product_id,recommended_product_id:source.id,placement:context.placement||"configured"});
  }else{
    setTimeout(()=>showUpsell(source,false),90);
  }
};

function itemTotal(i){return (Number(i.product.price||0)+(i.addons||[]).reduce((s,a)=>s+Number(a.price||0),0))*Number(i.qty||1)}
function cartSubtotal(){return cart.reduce((s,i)=>s+itemTotal(i),0)}
function updateCartBar(){
  const count=cart.reduce((s,i)=>s+Number(i.qty||0),0);
  $("cartCount").textContent=count?count+" "+(count===1?"item":"itens")+" no pedido":"Carrinho vazio";
  $("cartTotal").textContent=money(cartSubtotal());
}

function renderCart(){
  const has=cart.length>0;$("cartEmpty").style.display=has?"none":"block";$("checkoutArea").style.display=has?"block":"none";
  $("cartItems").innerHTML=cart.map(i=>'<div class="cart-item"><div class="row"><div><h3>'+i.qty+'x '+escapeHtml(i.product.name)+'</h3><small>'
    +((i.addons||[]).length?'Adicionais: '+i.addons.map(a=>escapeHtml(a.name)).join(", "):'Sem adicionais')+(i.notes?'<br>Obs.: '+escapeHtml(i.notes):'')
    +'</small></div><div style="text-align:right"><b>'+money(itemTotal(i))+'</b><br><button class="remove" type="button" data-remove="'+escapeHtml(i.id)+'">Remover</button></div></div></div>').join("");
  document.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{cart=cart.filter(i=>String(i.id)!==b.dataset.remove);updateCartBar();renderCart();saveCart()});
  renderCartRecommendations();
  updateSummary();
}

function updateSummary(){
  if(!business)return;
  const sub=cartSubtotal(),delivery=/entrega/i.test($("fulfillment").value)?Number(business.delivery_fee||0):0;
  $("subtotal").textContent=money(sub);$("deliveryFee").textContent=delivery?money(delivery):"Grátis";$("finalTotal").textContent=money(sub+delivery);
  const deliveryOn=/entrega/i.test($("fulfillment").value);
  $("deliveryFields").style.display=deliveryOn?"grid":"none";
}

function updatePayment(){
  const cash=/dinheiro/i.test($("payment").value);
  $("cashChange").classList.toggle("show",cash);
}

$("cartbar").onclick=()=>{renderCart();openModal("cartModal","closeCart");track(IS_DEMO?"demo_open_cart":"menu_open_cart",{items:cart.length,business_slug:SLUG})};
$("closeCart").onclick=()=>closeModal("cartModal");
$("fulfillment").onchange=updateSummary;$("payment").onchange=updatePayment;
let searchTimer=null;
$("search").oninput=()=>{
  renderProducts();clearTimeout(searchTimer);const q=$("search").value.trim();
  if(q.length>=2)searchTimer=setTimeout(()=>track("menu_search",{business_slug:SLUG,query_length:q.length,demo:IS_DEMO}),700);
};

document.querySelectorAll("#checkoutArea input,#checkoutArea textarea,#checkoutArea select").forEach(el=>el.addEventListener("input",()=>{
  if(!formStarted){formStarted=true;track("checkout_form_started",{business_slug:SLUG,demo:IS_DEMO})}
},{passive:true}));

$("sendWhats").onclick=()=>previewOrder();
$("previewBack").onclick=()=>closeModal("previewModal");
$("openWhats").onclick=()=>{
  if(!previewUrl)return;
  track(IS_DEMO?"demo_whatsapp_opened":"menu_whatsapp_opened",{items:cart.length,business_slug:SLUG});
  window.open(previewUrl,"_blank","noopener");
};

function previewOrder(){
  if(!cart.length)return;
  const sub=cartSubtotal();
  if(Number(business?.minimum_order||0)>0&&sub<Number(business.minimum_order)){announce("O pedido mínimo é "+money(Number(business.minimum_order))+".");return}
  const name=$("customer").value.trim();if(!name){announce("Informe seu nome para gerar o pedido.");$("customer").focus();return}
  const fulfillment=$("fulfillment").value;
  const street=$("street").value.trim(),number=$("number").value.trim(),neighborhood=$("neighborhood").value.trim(),complement=$("complement").value.trim(),reference=$("reference").value.trim();
  if(/entrega/i.test(fulfillment)&&(!street||!number||!neighborhood)){announce("Informe rua, número e bairro para a entrega.");(!street?$("street"):!number?$("number"):$("neighborhood")).focus();return}
  const address=/entrega/i.test(fulfillment)?[street,number,neighborhood,complement].filter(Boolean).join(", "):"";
  const payment=$("payment").value,phone=$("phone").value.trim(),orderNotes=$("orderNotes").value.trim(),fee=/entrega/i.test(fulfillment)?Number(business?.delivery_fee||0):0;
  let lines=["*PEDIDO"+(IS_DEMO?" DEMONSTRATIVO":"")+" — "+String(business?.name||"LC MENU PRO").toUpperCase()+"*","",
    "Cliente: "+name+(phone?" · "+phone:""),"Recebimento: "+fulfillment+(address?" · "+address:""),"Pagamento: "+payment];
  if(reference)lines.push("Referência: "+reference);
  if(/dinheiro/i.test(payment)){
    const change=$("changeFor").value.trim();
    lines.push("Troco: "+(change?("para "+change):"não informado"));
  }
  lines.push("","*ITENS*");
  cart.forEach(i=>{lines.push(i.qty+"x "+i.product.name+" — "+money(itemTotal(i)));if((i.addons||[]).length)lines.push("  + "+i.addons.map(a=>a.name).join(", "));if(i.notes)lines.push("  Obs.: "+i.notes)});
  lines.push("","Subtotal: "+money(sub),"Entrega: "+(fee?money(fee):"Grátis"),"*Total: "+money(sub+fee)+"*");
  if(orderNotes)lines.push("","Observação: "+orderNotes);
  if(IS_DEMO)lines.push("","","Demonstração gerada pelo LC Menu Pro.");
  const message=lines.join("\n");
  $("previewText").textContent=message;
  previewUrl=WHATS?WHATS+"?text="+encodeURIComponent(message):"";
  $("openWhats").disabled=!previewUrl;
  $("openWhats").textContent=previewUrl?"Abrir no WhatsApp":"WhatsApp não configurado";
  track(IS_DEMO?"demo_generate_whatsapp":"menu_generate_whatsapp",{items:cart.length,total:sub+fee,business_slug:SLUG});
  openModal("previewModal","previewBack");
}

function saveCart(){
  try{
    const items=cart.map(i=>({product_id:i.product.id,qty:i.qty,addon_ids:(i.addons||[]).map(a=>a.id),notes:i.notes||""}));
    localStorage.setItem(CART_KEY,JSON.stringify({expires:Date.now()+CART_TTL,items}));
  }catch{}
}
function restoreCart(){
  try{
    const raw=JSON.parse(localStorage.getItem(CART_KEY)||"null");
    if(!raw||raw.expires<Date.now()||!Array.isArray(raw.items)){localStorage.removeItem(CART_KEY);return}
    cart=raw.items.map(saved=>{
      const product=products.find(p=>String(p.id)===String(saved.product_id));if(!product||product.available===false)return null;
      const map=new Map(allAddons(product).map(a=>[String(a.id),a]));
      return {id:crypto.randomUUID(),product,qty:Math.max(1,Math.min(99,Number(saved.qty)||1)),addons:(saved.addon_ids||[]).map(id=>map.get(String(id))).filter(Boolean),notes:String(saved.notes||"").slice(0,500)};
    }).filter(Boolean);
  }catch{cart=[]}
}

function openModal(id,focusId){
  lastFocus=document.activeElement;
  const modal=$(id);modal.classList.add("open");modal.setAttribute("aria-hidden","false");
  document.body.style.overflow="hidden";
  requestAnimationFrame(()=>$(focusId)?.focus());
}
function closeModal(id){
  const modal=$(id);modal.classList.remove("open");modal.setAttribute("aria-hidden","true");
  if(!document.querySelector(".modal.open"))document.body.style.overflow="";
  if(lastFocus&&typeof lastFocus.focus==="function")lastFocus.focus();
}
document.querySelectorAll(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModal(m.id)}));
document.addEventListener("keydown",e=>{
  const modal=document.querySelector(".modal.open:last-of-type")||document.querySelector(".modal.open");
  if(!modal)return;
  if(e.key==="Escape"){e.preventDefault();closeModal(modal.id);return}
  if(e.key==="Tab")trapFocus(e,modal);
});
function trapFocus(e,modal){
  const list=[...modal.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>el.offsetParent!==null);
  if(!list.length)return;const first=list[0],last=list[list.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
}
$("closeProduct").onclick=()=>closeModal("productModal");
$("upsellNoThanks").onclick=()=>closeModal("upsellModal");
$("closeUpsell").onclick=()=>closeModal("upsellModal");
function announce(message){$("toast").textContent=message;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),1800)}

function track(name,meta){
  try{
    let sid=localStorage.getItem("lc_menu_sid");if(!sid){sid=crypto.randomUUID();localStorage.setItem("lc_menu_sid",sid)}
    fetch("/lcai/v1/eduzz/menu-pro/event",{method:"POST",headers:{"content-type":"application/json"},keepalive:true,body:JSON.stringify({
      event_name:name,session_id:sid,path:location.pathname,referrer:document.referrer,
      utm_source:TRACK_PARAMS.get("utm_source"),utm_medium:TRACK_PARAMS.get("utm_medium"),utm_campaign:TRACK_PARAMS.get("utm_campaign"),
      utm_content:TRACK_PARAMS.get("utm_content"),utm_term:TRACK_PARAMS.get("utm_term"),metadata:meta||{}
    })}).catch(()=>{})
  }catch{}
}
boot();
})();