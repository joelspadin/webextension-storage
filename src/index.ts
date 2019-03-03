import { browser, Storage } from 'webextension-polyfill-ts';

export type StorageAreaName = 'sync' | 'local' | 'managed';

const STORAGE_AREAS: Record<StorageAreaName, Storage.StorageArea> = {
    'local': browser.storage.local,
    'managed': browser.storage.managed,
    'sync': browser.storage.sync,
};

export interface StorageChange<T> {
    /**
     * The old value of the item, if there was an old value.
     * Optional.
     */
    oldValue?: T;

    /**
     * The new value of the item, if there is a new value.
     * Optional.
     */
    newValue?: T;
}

export type StorageListener<T> = (change: StorageChange<T>, key: string) => void;

/** Dictionary of setting keys and values. */
export interface IStorageItems {
    [key: string]: any;
}

/** Options for creating StorageArea objects. */
export interface IStorageAreaOptions<T extends IStorageItems> {
    /** Default values for all settings. */
    defaults: T;
    storageArea?: StorageAreaName;
}

/** A property with get/set functions for one setting. */
export interface IStorageAccessor<T> {
    /** The key of the setting in storage. */
    readonly key: string;
    /** The default value of the setting. */
    readonly default: T;

    /** Get the setting value. */
    get(): Promise<T>;
    /** Set the setting value. */
    set(value: T): Promise<void>;
    /** Reset the setting to its default value. */
    reset(): Promise<void>;

    /** Add a listener for changes to the setting. */
    addListener(callback: StorageListener<T>): void;
    /** Remove a listener for changes to the setting. */
    removeListener(callback: StorageListener<T>): void;
}

/** Creates an IStorageAccessor for each key in an ISettingItems. */
export type IStorageAccessorProps<T extends IStorageItems> = {
    readonly [P in keyof T]: IStorageAccessor<T[P]>;
}

/** StorageArea<T> with accessor properties for each setting. */
export type IStorageArea<T extends IStorageItems> = StorageArea<T> & IStorageAccessorProps<T>;

// TODO: remove casts once https://github.com/Microsoft/TypeScript/issues/1863 is fixed.
/** Symbol for StorageArea._listeners to store a listener for any setting. */
const AllSettings = Symbol('all settings') as unknown as string;

/**
 * Wrapper around browser.storage that provides default values and typings for
 * each setting.
 */
export class StorageArea<T extends IStorageItems> {
    public readonly defaults: T;

    private readonly _storage: Storage.StorageArea;
    private readonly _storageName: StorageAreaName = 'local';
    private readonly _accessors: { [key: string]: IStorageAccessor<any> } = {};

    private _listeners: { [key: string]: Set<StorageListener<any>> } = {};

    private constructor(options: IStorageAreaOptions<T>) {
        this.defaults = options.defaults;

        if (options.storageArea) {
            this._storageName = options.storageArea;
        }

        if (!(this._storageName in STORAGE_AREAS)) {
            throw new Error(`Invalid storage area: ${this._storageName}`);
        }

        this._storage = STORAGE_AREAS[this._storageName];
        this._makeProperties();

        browser.storage.onChanged.addListener(this._onChanged);
    }

    /** Detach all event listeners, allowing the object to be freed. */
    public dispose() {
        browser.storage.onChanged.removeListener(this._onChanged);

        for (let key in this._listeners) {
            if (this._listeners.hasOwnProperty(key)) {
                delete this._listeners[key];
            }
        }
    }

    /** Create a new storage area. */
    public static create<T>(options: IStorageAreaOptions<T>): IStorageArea<T> {
        return new StorageArea(options) as IStorageArea<T>;
    }

    /** Get a dictionary containing all setting values. */
    public async get(): Promise<T>;
    /** Get the value of a single setting. */
    public async get<K extends keyof T>(key: K): Promise<T[K]>;
    /** Get the value of a single setting. */
    public async get(key: string): Promise<any>;
    public async get(key?: string) {
        if (key === undefined) {
            return await this._storage.get();
        } else {
            return (await this._storage.get(key))[key];
        }
    }

    /**
     * Initialize all unset settings to their default values.
     *
     * Any setting values that are already stored will not be modified.
     */
    public async initDefaults(): Promise<void> {
        let setItems = await this.get();
        let unsetItems: Partial<T> = {};

        for (let key in this.defaults) {
            if (this.defaults.hasOwnProperty(key) && !(key in setItems)) {
                unsetItems[key] = this.defaults[key];
            }
        }

        return this.set(unsetItems);
    }

    /** Get whether a value is stored for a setting. */
    public async isDefined<K extends keyof T>(key: K): Promise<boolean>;
    /** Get whether a value is stored for a setting. */
    public async isDefined(key: string): Promise<boolean>;
    public async isDefined(key: string) {
        return (await this.get(key)) !== undefined;
    }

    /** Reset a setting to its default value. */
    public async reset<K extends keyof T>(key: K): Promise<void>;
    /** Reset a setting to its default value. */
    public async reset(key: string): Promise<void>;
    public async reset(key: string) {
        if (key in this.defaults) {
            return this.set(key, this.defaults[key]);
        } else {
            throw new Error(`No default value for setting: ${key}`);
        }
    }

    /** Reset all settings to their default values. */
    public async resetAll(): Promise<void> {
        return this.set(this.defaults);
    }

    /** Set the values of multiple settings. */
    public async set(items: Partial<T>): Promise<void>;
    /** Set the value of one setting. */
    public async set<K extends keyof T>(key: K, value: T[K]): Promise<void>;
    /** Set the value of one setting. */
    public async set(key: string, value: any): Promise<void>;
    public async set(key: string | Partial<T>, value?: any) {
        let items: Partial<T>;

        if (typeof key === 'string') {
            // set one item.
            items = <Partial<T>>{ [key]: value };
        } else {
            // set many items.
            items = key;
        }

        return this._storage.set(items);
    }

    public accessor<K extends keyof T>(key: K): IStorageAccessor<T[K]>;
    public accessor(key: string): IStorageAccessor<any>;
    public accessor(key: string) {
        return this._accessors[key] || this._makeAccessor(key);
    }

    /** Add a listener for changes to all settings. */
    public addListener(callback: StorageListener<any>): void;
    /** Add a listener for changes to a setting. */
    public addListener<K extends keyof T>(key: K, callback: StorageListener<T[K]>): void;
    /** Add a listener for changes to a setting. */
    public addListener(key: string, callback: StorageListener<any>): void;
    public addListener(a0: string | StorageListener<any>, a1?: StorageListener<any>) {
        const {key, callback} = this._getListenerArgs(a0, a1);

        if (key in this._listeners) {
            this._listeners[key].add(callback);
        } else {
            this._listeners[key] = new Set([callback]);
        }
    }

    /** Remove a listener for changes to all settings. */
    public removeListener(callback: StorageListener<any>): void;
    /** Remove a listener for changes to a setting. */
    public removeListener<K extends keyof T>(key: K, callback: StorageListener<T[K]>): void;
    /** Remove a listener for changes to a setting. */
    public removeListener(key: string, callback: StorageListener<any>): void;
    public removeListener(a0: string | StorageListener<any>, a1?: StorageListener<any>) {
        const {key, callback} = this._getListenerArgs(a0, a1);

        if (key in this._listeners) {
            this._listeners[key].delete(callback);
        }
    }

    private _getListenerArgs(a0: string | StorageListener<any>, a1?: StorageListener<any>) {
        let key: string;
        let callback: StorageListener<any>;

        if (a1) {
            // Args should be (key: string, callback: StorageListener<any>)
            if (typeof a0 !== 'string') {
                throw new TypeError('Expected key to be a string');
            }
            key = a0;
            callback = a1;
        } else {
            // Args should be (callback: StorageListener<any>)
            if (typeof a0 !== 'function') {
                throw new TypeError('Expected callback to be a function');
            }

            key = AllSettings;
            callback = a0;
        }

        return { key, callback };
    }

    private _makeAccessor(key: string) {
        let accessor: IStorageAccessor<any> = {
            key: key,
            default: this.defaults[key],

            get: () => this.get(key),
            set: (value) => this.set(key, value),
            reset: () => this.reset(key),

            addListener: (callback) => this.addListener(key, callback),
            removeListener: (callback) => this.removeListener(key, callback),
        };

        this._accessors[key] = accessor;
        return accessor;
    }

    private _makeProperties(): void {
        let descriptors: PropertyDescriptorMap = {};

        for (let key in this.defaults) {
            if (this.defaults.hasOwnProperty(key) && !this.hasOwnProperty(key)) {
                descriptors[key] = {
                    get: () => this.accessor(key),
                    enumerable: true,
                };
            }
        }

        Object.defineProperties(this, descriptors);
    }

    private _onChanged = (changes: { [key: string]: Storage.StorageChange }, areaName: string) => {
        if (areaName != this._storageName) {
            return;
        }

        function _send(key: string, list: Set<StorageListener<any>>) {
            for (const listener of list) {
                listener(changes[key], key);
            }
        }

        for (let key in changes) {
            if (key in this._listeners) {
                _send(key, this._listeners[key]);
            }

            if (AllSettings in this._listeners) {
                _send(key, this._listeners[AllSettings]);
            }
        }
    }
}
