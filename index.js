import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import 'react-native-get-random-values';
import { polyfillGlobal } from 'react-native/Libraries/Utilities/PolyfillFunctions';
import 'fast-text-encoding';
import { Buffer } from 'buffer';
global.Buffer = Buffer;
import { ReadableStream, TransformStream } from 'web-streams-polyfill';
import { EventTarget, Event } from 'event-target-shim';

polyfillGlobal('ReadableStream', () => ReadableStream);
polyfillGlobal('TransformStream', () => TransformStream);
polyfillGlobal('EventTarget', () => EventTarget);
polyfillGlobal('Event', () => Event);

if (typeof MessageEvent === 'undefined') {
  class MessageEventPolyfill extends Event {
    data;
    origin;
    lastEventId;
    source;
    ports;

    constructor(type, options = {}) {
      super(type, options);
      this.data = options.data || null;
      this.origin = options.origin || '';
      this.lastEventId = options.lastEventId || '';
      this.source = options.source || null;
      this.ports = options.ports || [];
    }
  }
  polyfillGlobal('MessageEvent', () => MessageEventPolyfill);
}

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
