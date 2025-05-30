'use strict'

const PRIVATE_CHANNEL_INDEX = 7,
    PRIVATE_CHANNEL_ID = -2 >>> 0,
    PUBLIC_MATCH = /^!([^!].*)$/;


class CommandBase {
    constructor(mod) {
        this.mod = mod;
        this.loaded = false;
        this.queue = [];
        this.hooks = new Map();

        mod.hook('S_LOGIN', 'event', () => { this.loaded = false; });

        mod.hook('S_LOAD_CLIENT_USER_SETTING', 'raw', { order: 50, filter: { fake: null } }, () => {
            const disabled = !!require("../../bin/config").loadConfig()?.nochatchannel;

            if (disabled || this.loaded)
                return;

            this.loaded = true;
            process.nextTick(() => {
                mod.send('S_JOIN_PRIVATE_CHANNEL', 2, {
                    index: PRIVATE_CHANNEL_INDEX,
                    channelId: PRIVATE_CHANNEL_ID,
                    unk: [],
                    name: this.mod.settings.private_channel_name,
                });

                if (this.mod.settings.login_message)
                    this.message(null, `${this.mod.publisher.toUpperCase()}-${this.mod.majorPatchVersion}.${this.mod.minorPatchVersion} ${this.mod.environment !== 'live' ? `${this.mod.environment} ` : ''}(${this.mod.dispatch.protocolVersion})`);

                mod.setTimeout(() => {
                    if (this.queue) {
                        const queue = this.queue;
                        this.queue = null;
                        queue.forEach(entry => this.message(...entry));
                    }
                }, 2000);
            });
        })

        mod.hook('S_JOIN_PRIVATE_CHANNEL', 2, event => event.index === PRIVATE_CHANNEL_INDEX ? false : undefined);
        mod.hook('C_LEAVE_PRIVATE_CHANNEL', 1, event => event.index === PRIVATE_CHANNEL_INDEX ? false : undefined);

        if (mod.majorPatchVersion >= 35) {
            mod.hook('C_REQUEST_PRIVATE_CHANNEL_INFO', 1, event => {
                if (event.channelId === PRIVATE_CHANNEL_ID) {
                    mod.send('S_REQUEST_PRIVATE_CHANNEL_INFO', 1, {
                        owner: true,
                        password: 0,
                        members: [],
                        friends: []
                    });
                    return false;
                }
            });
        }

        let lastError,
            hookCommand = message => {
                let args = null;

                try {
                    args = parseArgs(stripOuterHTML(message));
                } catch (e) {
                    return `Syntax error: ${e.message}`;
                }

                try {
                    if (!this.exec(args))
                        return `Unknown command "${args[0]}"`;
                } catch (e) {
                    this.message(null, `Error running callback for command "${args[0]}"`);
                    mod.error(e);
                }
            }

        mod.hook('C_CHAT', 1, { order: -10 }, event => {
            if (event.channel === 11 + PRIVATE_CHANNEL_INDEX) {
                lastError = hookCommand(event.message);
                if (!lastError)
                    return false;
            } else if (this.mod.settings.public_enable) {
                const str = PUBLIC_MATCH.exec(stripOuterHTML(event.message).trim());

                if (str) {
                    lastError = hookCommand(str[1]);
                    if (!lastError)
                        return false;
                }
            }
        });

        // Let other modules handle possible commands before we silence them
        mod.hook('C_CHAT', 1, { order: 10, filter: { silenced: null } }, event => {
            if (lastError) {
                if (!event.$silenced)
                    this.message(null, lastError);
                lastError = undefined;
                return false;
            }
        });

        mod.hook('C_WHISPER', mod.majorPatchVersion >= 108 ? 2 : 1, { order: -10 }, event => {
            if (!this.mod.settings.public_enable)
                return;

            const str = PUBLIC_MATCH.exec(stripOuterHTML(event.message).trim());

            if (str) {
                lastError = hookCommand(str[1]);
                if (!lastError)
                    return false;
            }
        });

        // Let other modules handle possible commands before we silence them
        mod.hook('C_WHISPER', mod.majorPatchVersion >= 108 ? 2 : 1, { order: 10, filter: { silenced: null } }, event => {
            if (!this.mod.settings.public_enable)
                return;

            if (lastError) {
                if (!event.$silenced)
                    this.message(null, lastError);
                lastError = undefined;
                return false;
            }
        });

        // Add own commands
        this.add(['toolbox', 'proxy'], {
            $default() {
                this.message(null, `TERA Toolbox commands:`);
                this.message(null, `silent - Toggles ability to hide command messages from game chat`);
                this.message(null, `onlychannel - Toggles ability to enter commands in Toolbox channel only (recommended) or all channels`);
                this.message(null, `loginmessage - Toggles the status message shown on login`);
                this.message(null, `load [module name] [0(default) - load network part, 1 - load fully] - Loads the given module`);
                this.message(null, `unload [module name] [0(default) - unload network part, 1 - unload fully] - Unloads the given module`);
                this.message(null, `reload [module name] - Reloads the given module`);
            },
            silent() {
                this.mod.settings.silent_mode = !this.mod.settings.silent_mode;
                this.message(null, `Command messages in game chat will be ${this.mod.settings.silent_mode ? 'hidden' : 'visible'}`);
            },
            onlychannel() {
                this.mod.settings.public_enable = !this.mod.settings.public_enable;
                this.message(null, `Commands can now be entered in ${this.mod.settings.public_enable ? 'all chat channels' : 'Toolbox channel only'}`);
            },
            loginmessage() {
                this.mod.settings.login_message = !this.mod.settings.login_message;
                this.message(null, `Toolbox login message ${this.mod.settings.login_message ? 'enabled' : 'disabled'}`);
            },
            load(name, mode = "0") {
                if (!name) {
                    this.message(null, 'No module name specified!');
                    return;
                }

                if(mode == "0") {
                    let modRef = mod.manager.get(name);
                    if (modRef) { 
                        modRef.loadNetworkInstance(this.mod.dispatch);
                        this.message(null, `Loaded network instance for mod "${name}" in current connection!`);
                    }
                    else {
                        this.message(null, `Unable to load network instance for mod "${name}"!`);
                    }
                    return;
                }

                const result = this.mod.manager.load(name);
                if (result)
                    this.message(null, `Loaded "${name}"!`);
                else
                    this.message(null, `Unable to load "${name}", check log for details!`);
            },
            unload(name, mode = "0") {
                if (!name) {
                    this.message(null, 'No module name specified!');
                    return;
                }

                if(mode == "0") {
                    let modRef = mod.manager.get(name);
                    if (modRef) { 
                        modRef.unloadNetworkInstance(this.mod.dispatch);
                        this.message(null, `Unloaded network instance for mod "${name}" in current connection!`);
                    }
                    else {
                        this.message(null, `Unable to unload network instance for mod "${name}"!`);
                    }
                    return;
                }

                const result = this.mod.manager.unload(name);
                if (result)
                    this.message(null, `Unloaded "${name}"!`);
                else
                    this.message(null, `Unable to unload "${name}", check log for details!`);
            },
            reload(name) {
                if (!name) {
                    this.message(null, 'No module name specified!');
                    return;
                }

                const result = this.mod.manager.reload(name);
                if (result)
                    this.message(null, `Reloaded "${name}"!`);
                else
                    this.message(null, `Unable to reload "${name}", check log for details!`);
            },
        }, this);
    }

    exec(str) {
        const args = Array.isArray(str) ? str : parseArgs(str);
        if (args.length === 0)
            return false;

        const cb = this.hooks.get(args[0].toLowerCase());

        if (cb) {
            cb.call(...args);
            return true;
        }

        return false;
    }

    add(cmd, cb, ctx) {
        if (typeof cb === 'function') {
            if (ctx !== undefined)
                cb = cb.bind(ctx);
        } else if (typeof cb === 'object') {
            cb = makeSubCommandHandler(cb, ctx);
        } else {
            throw new Error('Callback must be a function or object');
        }

        if (Array.isArray(cmd)) {
            for (let c of cmd)
                this.add(c, cb);
            return;
        }

        if (typeof cmd !== 'string')
            throw new Error('Command must be a string or array of strings');
        if (cmd === '')
            throw new Error('Command must not be an empty string');

        cmd = cmd.toLowerCase();
        if (this.hooks.has(cmd))
            throw new Error(`Command already registered: ${cmd}`);

        this.hooks.set(cmd, cb);
    }

    remove(cmd) {
        if (Array.isArray(cmd)) {
            for (let c of cmd)
                this.remove(c);
            return;
        }

        if (typeof cmd !== 'string')
            throw new Error('Command must be a string or array of strings');
        if (cmd === '')
            throw new Error('Command must not be an empty string');

        this.hooks.delete(cmd.toLowerCase());
    }

    message(modName, msg) {
        const showModName = modName && !this.mod.settings.hide_module_names;
        
        if (this.queue) {
            // Not ready yet, delay sending the message
            this.queue.push([modName, msg]);
        } else {
            if (this.mod.settings.silent_mode)
                this.mod.log(showModName ? `[${modName}] ${msg}` : msg);
            else
                this.mod.send('S_PRIVATE_CHAT', 1, {
                    channel: PRIVATE_CHANNEL_ID,
                    authorID: 0,
                    authorName: '',
                    message: (showModName) ? `[${modName}] ${msg}` : ` ${msg}`,
                });
        }
    }
}

function makeSubCommandHandler(_obj, ctx) {
    const obj = {};

    for (let cmd in _obj) {
        const cb = _obj[cmd];

        cmd = cmd.toLowerCase();

        if (typeof cb === 'function')
            obj[cmd] = ctx !== undefined ? cb.bind(ctx) : cb;
        else if (typeof cb === 'object')
            obj[cmd] = makeSubCommandHandler(cb, ctx);
        else
            throw new Error('Sub-command callback must be a function or object');
    }

    return function subCommandHandler(cmd) {
        const cb = (cmd !== undefined ? obj[cmd.toLowerCase()] : obj.$none) || obj.$default;

        if (cb)
            cb.apply(null, (arguments && cb !== obj.$default) ? Array.prototype.slice.call(arguments, 1) : arguments);
    }
}

function stripOuterHTML(str) {
    return str.replace(/^<[^>]+>|<\/[^>]+><[^\/][^>]*>|<\/[^>]+>$/g, '');
}

function parseArgs(str) {
    const parseHTML = /.*?<\/.*?>/g,
        args = [];

    let arg = '',
        quote = '';

    for (let i = 0, c = ''; i < str.length; i++) {
        c = str[i];

        switch (c) {
            case '<':
                parseHTML.lastIndex = i + 1;

                let len = parseHTML.exec(str);

                if (!len)
                    throw new Error('HTML parsing failure');

                len = len[0].length;
                arg += str.substr(i, len + 1);
                i += len;
                break;
            case '\\':
                c = str[++i];

                if (c === undefined)
                    throw new Error('Unexpected end of line');

                arg += c;
                break;
            case '\'':
            case '"':
                if (arg === '' && quote === '') {
                    quote = c;
                    break;
                }
                if (quote === c) {
                    quote = '';
                    break;
                }
                arg += c;
                break
            case ' ':
                if (quote === '') {
                    if (arg !== '') {
                        args.push(arg);
                        arg = '';
                    }
                    break;
                }
            default:
                arg += c;
        }
    }

    if (arg !== '') {
        if (quote !== '')
            throw new Error('Expected ' + quote);

        args.push(arg);
    }

    return args;
}


class Command {
    constructor(mod, base) {
        this.mod = mod;
        this.base = base || new CommandBase(mod);
        this.commands = new Set();
    }

    destructor() {
        this.base.remove(Array.from(this.commands));
        this.commands.clear();
    }

    exec(str) {
        return this.base.exec(str);
    }

    add(cmd, cb, ctx) {
        this.base.add(cmd, cb, ctx);

        if (Array.isArray(cmd)) {
            for (let c of cmd)
                this.commands.add(c);
        } else {
            this.commands.add(cmd);
        }
    }

    remove(cmd) {
        this.base.remove(cmd);

        if (Array.isArray(cmd)) {
            for (let c of cmd)
                this.commands.delete(c);
        } else {
            this.commands.delete(cmd);
        }
    }

    message(msg) {
        return this.base.message(this.mod.info.options.cliName || this.mod.info.rawName, msg);
    }

    createInstance(mod) {
        return new Command(mod, this.base);
    }
}

module.exports = {
    NetworkMod: Command,
    RequireInterface: (globalMod, clientMod, networkMod, requiredBy) => networkMod,
};
