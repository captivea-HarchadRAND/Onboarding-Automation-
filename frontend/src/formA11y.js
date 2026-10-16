// Accessibilité des formulaires, appliquée une fois pour toute l'app (ui-ux-pro-max : form-labels,
// required-indicators, placeholder-only). Observe le DOM et, pour chaque champ :
//   - relie les <label> à leur champ (for/id) quand les pages ne le font pas ;
//   - marque les labels des champs obligatoires (astérisque via CSS) ;
//   - donne un nom accessible aux champs sans label (aria-label = placeholder).
let seq = 0;

const CONTROL = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea, button.select-btn';

function controlFor(label) {
  if (label.control || label.hasAttribute('for')) return null;
  // Champ juste après le label, ou dans l'élément frère suivant (ex. wrapper de champ avec icône)
  const next = label.nextElementSibling;
  if (!next) return null;
  if (next.matches(CONTROL)) return next;
  return next.querySelector(CONTROL);
}

function enhance(root) {
  for (const label of root.querySelectorAll('label')) {
    const field = controlFor(label);
    if (field) {
      if (!field.id) field.id = `f-${++seq}`;
      label.htmlFor = field.id;
    }
    const target = label.control;
    if (target && target.required && !/\*\s*$/.test(label.textContent)) label.dataset.required = 'true';
  }
  for (const el of root.querySelectorAll(CONTROL)) {
    if (el.labels?.length || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) continue;
    const text = el.getAttribute('placeholder') || el.getAttribute('title');
    if (text) el.setAttribute('aria-label', text);
  }
}

export function initFormA11y() {
  let queued = false;
  const run = () => { queued = false; enhance(document.body); };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(run, 30); // pas requestAnimationFrame : suspendu quand l'onglet est masqué
  }).observe(document.body, { childList: true, subtree: true });
  run();
}
