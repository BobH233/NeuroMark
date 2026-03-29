import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createDiscreteApi } from 'naive-ui';
import App from './App.vue';
import router from './router';
import './styles/global.css';
import 'katex/dist/katex.min.css';
import 'md-editor-v3/lib/style.css';

const app = createApp(App);
const pinia = createPinia();

const { message, dialog, notification, loadingBar } = createDiscreteApi([
  'message',
  'dialog',
  'notification',
  'loadingBar',
]);

app.config.globalProperties.$message = message;
app.config.globalProperties.$dialog = dialog;
app.config.globalProperties.$notification = notification;
app.config.globalProperties.$loadingBar = loadingBar;

app.use(pinia);
app.use(router);
app.mount('#app');

