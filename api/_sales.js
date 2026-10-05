// Keep production closed until the owner explicitly opens the physical drop.
// Preview/development preserve sandbox testing unless explicitly closed.
export function salesOpen() {
    const setting = process.env.VOID_SALES_OPEN;
    return setting === 'true' || (process.env.VERCEL_ENV !== 'production' && setting !== 'false');
}
