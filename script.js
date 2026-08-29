const places = [
  {name:'Sidrería El Tropical',tags:['cachopo','playa'],filter:['centro'],text:'Frente a la playa. Su plato estrella es el cachopo. No tiene terraza.',address:'Av. Rufo García Rendueles, 3',phone:'984 70 29 78'},
  {name:'Taberna del Piano',tags:['cachopo','centro'],filter:['centro'],text:'Cachopo y pastel de cabracho. Cochinillo y lechazo por encargo. No tiene terraza.',address:'C. Cabrales, 12',phone:'985 34 22 57'},
  {name:'Casa Yoli',tags:['merendero','terraza'],filter:['terraza'],text:'Tortilla de patatas, calamares y escalopines. Zona merendero sin reserva y restaurante con reserva.',address:'Carretera de Caldones, 182',phone:'985 36 87 24'},
  {name:'Mesón Sancho',tags:['carnes','centro'],filter:['centro'],text:'Morcilla, criollo, mollejas, chuletones y, en temporada, ventresca de bonito. Necesario reservar.',address:'C. Begoña, 18 / C. de la Merced, 33',phone:'985 35 99 73 / 984 08 55 05'},
  {name:'Coalla Gourmet',tags:['tapeo','terraza'],filter:['centro','terraza'],text:'Vinos, quesos, embutidos, conservas y tapas. Terraza con zona al aire libre y cubierta.',address:'C. San Antonio, 8',phone:'985 34 84 00'},
  {name:'Casa Segundo',tags:['asturiana','terraza'],filter:['terraza'],text:'Fabada y carne gobernada, ambas por encargo. Se recomienda reservar. Zona merendero.',address:'Camino de las Quintas, 231',phone:'985 33 36 32'},
  {name:'La Casa del Mar',tags:['pescado','marisco'],filter:[],text:'Muy buenos pescados y mariscos. Es necesario reservar. No tiene terraza.',address:'Av. del Príncipe de Asturias, s/n',phone:'985 31 30 55'},
  {name:'Kausa Taberna',tags:['fusión','centro'],filter:['centro'],text:'Cocina japonesa-peruana: ceviche, sushi y arroz con carabineros. Necesario reservar.',address:'C. Santa Doradía, 5',phone:'984 01 80 97'},
  {name:'El Medio Lleno',tags:['terraza','Viesques'],filter:['terraza'],text:'Tortilla vaga de pulpo, fideuá y langostinos en tempura.',address:'C. Corín Tellado, 2',phone:'984 49 15 02'},
  {name:'La Pondala',tags:['roast beef','terraza'],filter:['terraza'],text:'Necesario reservar. El roast beef con puré de patata es por encargo.',address:'Av. Dionisio Cifuentes, 58',phone:'985 36 11 60'},
  {name:'El Varsovia',tags:['cócteles','terraza'],filter:['centro','terraza','copas'],text:'Bar conocido por sus cócteles, en el centro y frente a la playa.',address:'C. Cabrales, 18',phone:''},
  {name:'Plaza del Marqués',tags:['terrazas','vistas'],filter:['centro','terraza','copas'],text:'Al lado del Náutico. Con buen tiempo, cualquiera de sus terrazas es un plan perfecto.',address:'Plaza del Marqués / Plaza Pelayo',phone:''},
  {name:'La Cuesta del Cholo',tags:['atardecer','informal'],filter:['centro','terraza','copas'],text:'Compra una bebida en cualquiera de los bares y sal a disfrutar del atardecer. Sin reserva.',address:'Cimavilla, junto a la Plaza del Marqués',phone:''},
  {name:'La Ruta',tags:['bares','terraza'],filter:['centro','terraza','copas'],text:'Bares en la calle Begoña y alrededores. La mayoría cuenta con terraza.',address:'Calle Begoña y alrededores',phone:''},
  {name:'Pantai Beach Bar',tags:['atardecer','playa'],filter:['terraza','copas'],text:'Para tomar algo y ver el atardecer. Se puede llegar caminando hasta el final de la playa.',address:'Camino Camping, 119',phone:''}
];

const grid = document.querySelector('#places-grid');
function renderPlaces(filter='all'){
  grid.innerHTML = places.filter(p => filter === 'all' || p.filter.includes(filter)).map(p => `
    <article class="place">
      <div class="place-tags">${p.tags.map(t=>`<span class="place-tag">${t}</span>`).join('')}</div>
      <h3>${p.name}</h3><p>${p.text}</p>
      <address>${p.address}${p.phone ? ` · <a href="tel:${p.phone.replace(/[^+\d]/g,'')}">${p.phone}</a>` : ''}</address>
    </article>`).join('');
}
renderPlaces();

document.querySelectorAll('.filters button').forEach(button => button.addEventListener('click',()=>{
  document.querySelector('.filters .active').classList.remove('active');
  button.classList.add('active'); renderPlaces(button.dataset.filter);
}));

const nav=document.querySelector('#main-nav');
const menu=document.querySelector('.menu-button');
menu.addEventListener('click',()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',open)});
nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false')}));

const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target)}}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));
