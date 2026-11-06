import {Hono} from 'hono';
import {notifications} from '../../src/notifications';
const app=new Hono<{Bindings:Env}>();app.route('/api/v1',notifications);export default app;
