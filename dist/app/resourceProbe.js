export async function checkResource(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok)
        throw new Error(`${r.status}: ${url}`);
    return true;
}
