import * as net from 'net';

export function isPortAvailable(port: number, host: string = 'localhost'): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.once('connect', () => {
            socket.destroy();
            resolve(false);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('error', () => {
            socket.destroy();
            resolve(true);
        });
        socket.connect(port, host);
    });
}

export function waitForPort(port: number, timeoutMs: number = 45000, host: string = 'localhost'): Promise<boolean> {
    const startTime = Date.now();
    return new Promise((resolve) => {
        const check = () => {
            if (Date.now() - startTime > timeoutMs) {
                resolve(false);
                return;
            }
            const socket = new net.Socket();
            socket.setTimeout(1000);
            socket.once('connect', () => {
                socket.destroy();
                resolve(true);
            });
            socket.once('timeout', () => {
                socket.destroy();
                setTimeout(check, 500);
            });
            socket.once('error', () => {
                socket.destroy();
                setTimeout(check, 500);
            });
            socket.connect(port, host);
        };
        check();
    });
}

export function waitForPortRelease(port: number, timeoutMs: number = 3000, host: string = 'localhost'): Promise<boolean> {
    const startTime = Date.now();
    return new Promise((resolve) => {
        const check = () => {
            if (Date.now() - startTime > timeoutMs) {
                resolve(false);
                return;
            }
            isPortAvailable(port, host).then((available) => {
                if (available) {
                    resolve(true);
                } else {
                    setTimeout(check, 300);
                }
            });
        };
        check();
    });
}
