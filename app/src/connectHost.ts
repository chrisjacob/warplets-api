import {configureConnectHost} from '@10x/connect/host';
import {getRuntimeAppIconPath,getRuntimeAppName} from './brandAssets';
import {trackAppEvent,type AnalyticsEventName,type AnalyticsContext} from './analytics';
import {hapticSuccess} from './haptics';
configureConnectHost({name:getRuntimeAppName,icon:getRuntimeAppIconPath,success:hapticSuccess,track:(event,context)=>trackAppEvent(event as AnalyticsEventName,context as AnalyticsContext)});
