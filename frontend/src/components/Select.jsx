// [EN-TÊTE] Select.jsx — liste déroulante aux couleurs de l'app (remplace <select> : le menu natif ne se style pas).
// Même usage que <select> : <Select value onChange={e => e.target.value}> <option value="a">A</option> … </Select>.
// Menu rendu dans document.body (jamais coupé par un parent), clavier complet, ARIA combobox/listbox.
// Non contrôlé : defaultValue ; l'affectation e.target.value = '' dans onChange réinitialise la valeur.

import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Liste déroulante aux couleurs de l'app, remplaçant <select> : le menu natif du navigateur ne peut pas
// être stylé (surbrillance bleue du système, fond clair). Même usage que <select> :
//   <Select value onChange={e => e.target.value}> <option value="a">A</option> … </Select>
// Accessibilité : motif ARIA « combobox + listbox », focus conservé sur le bouton, clavier complet
// (↑ ↓ Début Fin Entrée Espace Échap, saisie de la première lettre). `style` s'applique au bouton.

const textOf = node => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isValidElement(node) ? textOf(node.props.children) : '';
};

function collectOptions(children, out = []) {
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      const label = textOf(child.props.children);
      out.push({ value: child.props.value != null ? String(child.props.value) : label, label, disabled: !!child.props.disabled });
    } else if (child.type === Fragment || child.type === 'optgroup') {
      collectOptions(child.props.children, out);
    }
  });
  return out;
}

const Chevron = ({ open }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"
    style={{ flex: 'none', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', color: 'var(--muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"
    style={{ flex: 'none', fill: 'none', stroke: 'var(--primary)', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export default function Select({
  value, defaultValue, onChange, disabled, style, className = '', id, title, name,
  'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, children,
}) {
  const options = useMemo(() => collectOptions(children), [children]);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue != null ? String(defaultValue) : '');
  const current = controlled ? String(value ?? '') : inner;
  const selected = options.find(o => o.value === current);

  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const typed = useRef({ text: '', timer: null });

  const enabledIdx = useCallback(from => {
    // Premier index activable à partir de `from` (borné)
    for (let i = Math.max(0, from); i < options.length; i++) if (!options[i].disabled) return i;
    return -1;
  }, [options]);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    const up = below < 180 && above > below;
    const maxH = Math.max(120, Math.min(280, up ? above : below));
    setPos({ left: r.left, width: r.width, top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined, maxH });
  }, []);

  const openList = () => {
    if (disabled) return;
    place();
    const sel = options.findIndex(o => o.value === current);
    setActive(sel >= 0 && !options[sel].disabled ? sel : enabledIdx(0));
    setOpen(true);
  };
  const closeList = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  const choose = o => {
    if (!o || o.disabled) return;
    if (!controlled) setInner(o.value);
    // Même forme qu'un événement <select> ; l'affectation `e.target.value = ''` réinitialise un Select non contrôlé.
    onChange?.({ target: { name, id, get value() { return o.value; }, set value(v) { if (!controlled) setInner(String(v)); } } });
    closeList(true);
  };

  // Fermeture au clic extérieur, au redimensionnement et au défilement hors de la liste
  useEffect(() => {
    if (!open) return undefined;
    const down = e => { if (!btnRef.current?.contains(e.target) && !listRef.current?.contains(e.target)) closeList(); };
    const scroll = e => { if (!listRef.current?.contains(e.target)) closeList(); };
    document.addEventListener('mousedown', down);
    window.addEventListener('resize', closeList);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('mousedown', down);
      window.removeEventListener('resize', closeList);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open, closeList]);

  useLayoutEffect(() => {
    if (open && active >= 0) listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => () => clearTimeout(typed.current.timer), []);

  const move = step => {
    if (!options.length) return;
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + step + options.length) % options.length;
      if (!options[i].disabled) { setActive(i); return; }
    }
  };

  const onKeyDown = e => {
    if (disabled) return;
    const k = e.key;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); openList(); }
      return;
    }
    if (k === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (k === 'Home') { e.preventDefault(); setActive(enabledIdx(0)); }
    else if (k === 'End') { e.preventDefault(); for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) { setActive(i); break; } }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(options[active]); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeList(true); }
    else if (k === 'Tab') closeList();
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Saisie : se placer sur la première option qui commence par les lettres tapées
      const t = typed.current;
      clearTimeout(t.timer);
      t.text += k.toLowerCase();
      t.timer = setTimeout(() => { t.text = ''; }, 600);
      const from = t.text.length === 1 ? active + 1 : active;
      const order = [...options.keys()].map(n => (n + Math.max(from, 0)) % options.length);
      const hit = order.find(i => !options[i].disabled && options[i].label.toLowerCase().startsWith(t.text));
      if (hit !== undefined) setActive(hit);
    }
  };

  const label = selected ? selected.label : '';
  const empty = !selected || selected.value === '';

  return (
    <>
      <button
        ref={btnRef} type="button" role="combobox" id={id} title={title} disabled={disabled}
        className={`select-btn ${className}`.trim()} style={style}
        data-value={current} data-empty={empty || undefined}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${uid}-o${active}` : undefined}
        aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}
        onClick={() => (open ? closeList() : openList())} onKeyDown={onKeyDown}
      >
        <span className="select-label">{label || ' '}</span>
        <Chevron open={open} />
      </button>
      {open && pos && createPortal(
        <ul
          ref={listRef} id={listId} role="listbox" className="select-pop"
          style={{ left: pos.left, minWidth: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}
          onMouseDown={e => e.preventDefault()} // garde le focus sur le bouton
        >
          {options.map((o, i) => {
            const isSel = o.value === current;
            return (
              <li
                key={`${o.value}-${i}`} id={`${uid}-o${i}`} role="option" data-i={i}
                aria-selected={isSel} aria-disabled={o.disabled || undefined}
                data-active={i === active || undefined}
                className="select-opt"
                onMouseMove={() => { if (!o.disabled && i !== active) setActive(i); }}
                onClick={() => choose(o)}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label || ' '}</span>
                {isSel && <Check />}
              </li>
            );
          })}
        </ul>,
        document.body
      )}
    </>
  );
}
