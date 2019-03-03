# WebExtension Storage

Helper for storing browser extension settings with TypeScript type information.

## Install

```shell
$ npm install -S @spadin/webextension-storage
```

## Usage

See [the documentation in index.ts](./src/index.ts) for more detailed usage info.

Also see [webextension-options](https://github.com/ChaosinaCan/webextension-options) for a React-based library that uses this to create an options page for your extension, and [webextension-example](https://github.com/ChaosinaCan/webextension-example) for an example extension using both libraries.

```typescript
// storage.ts
import { StorageArea } from '@spadin/webextension-storage';

export interface StorageItems {
    foo: boolean;
    bar: string;
    baz: number;
}

export var storage = StorageArea.create<StorageItems>({
    defaults: {
        foo: false,
        bar: 'bar',
        baz: 0,
    }
});

// background.ts
import { browser } from 'webextension-polyfill-ts';
import { storage } from './storage';

browser.runtime.onInstalled.addListener(async (details) => {
    // Fill in default values for any unset settings.
    await storage.initDefaults();

    // A property is automatically created on the StorageArea object for each
    // setting with get(), set(), and other functions. Use addListener() to run
    // a function when a setting changes.
    storage.foo.addListener((change, key) => {
        console.log(`key changed from ${change.oldValue} to ${change.newValue}`);
    });
});

async function toggleFoo() {
    // Any operation that reads from or writes to storage is asynchronous and
    // returns a promise.
    const foo = await storage.foo.get();
    await storage.foo.set(!foo);
}

async function incrementBaz() {
    // You can also access settings by name instead of using properties.
    const baz = await storage.get('baz');
    await storage.set('baz', baz + 1);
}

async function mogrify() {
    // You can get all settings with StorageArea.get() and write multiple
    // settings with StorageArea.set().
    const { foo, bar } = await storage.get();
    await storage.set({
        foo: !foo,
        bar: bar + bar,
    });
}
```