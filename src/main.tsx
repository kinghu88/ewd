import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AdminPage } from './components/AdminPage';
import './index.css';

/** /admin 为独立的商品管理后台，不加载学员端登录态 */
const isAdminPage = window.location.pathname.replace(/\/+$/, '') === '/admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isAdminPage ? <AdminPage /> : <App />}</StrictMode>,
);
