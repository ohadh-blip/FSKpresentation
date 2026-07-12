/* ================= Slide navigation ================= */
const deck = document.getElementById('deck');
const slides = Array.from(document.querySelectorAll('.slide'));
const dotsWrap = document.getElementById('nav-dots');
const counterCur = document.getElementById('counter-cur');
const navLabel = document.getElementById('nav-label');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

slides.forEach((s, i) => {
    const d = document.createElement('button');
    d.className = 'nav-dot' + (i === 0 ? ' active' : '');
    d.addEventListener('click', () => goTo(i));
    dotsWrap.appendChild(d);
});
const dots = Array.from(dotsWrap.children);

let current = 0;
function setActive(i) {
    current = i;
    dots.forEach((d, idx) => d.classList.toggle('active', idx === i));
    counterCur.textContent = String(i + 1).padStart(2, '0');
    navLabel.textContent = i === slides.length - 1 ? 'סוף' : 'גללו למטה';
    prevBtn.disabled = false;
    nextBtn.disabled = false;
}

function goTo(i) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    slides[i].scrollIntoView({behavior: 'smooth'});
}

prevBtn.addEventListener('click', () => goTo(current - 1)); 
nextBtn.addEventListener('click', () => goTo(current + 1));

window.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); goTo(current + 1); }
    if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); goTo(current - 1); }
});

let scrollTicking = false;
function updateActiveFromScroll() {
    const pos = deck.scrollTop + deck.clientHeight * 0.4;
    let idx = 0;
    for (let i = 0; i < slides.length; i++) {
        if (slides[i].offsetTop <= pos) idx = i;
    }
    if (idx !== current) setActive(idx);
    scrollTicking = false;
}

deck.addEventListener('scroll', () => {
    if (!scrollTicking) {
        requestAnimationFrame(updateActiveFromScroll);
        scrollTicking = true;
    }
});
