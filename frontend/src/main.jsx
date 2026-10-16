// [EN-TÊTE] main.jsx — point d'entrée React : charge les styles globaux (index.css), active l'accessibilité automatique des
// formulaires (formA11y.js) puis monte <App />.

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { initFormA11y } from './formA11y.js';

initFormA11y();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
