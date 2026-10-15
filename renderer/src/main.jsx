import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import LicenseGate from './LicenseGate.jsx';

createRoot(document.getElementById('root')).render(<LicenseGate><App /></LicenseGate>);   // 🔐 회원 확인을 통과해야 App 을 그린다(v0.9.25)
