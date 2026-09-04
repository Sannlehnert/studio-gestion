export function assertTestDatabase(): URL {
  if (
    process.env.NODE_ENV !== 'test' ||
    !process.env.TEST_DATABASE_URL ||
    !process.env.DATABASE_URL
  ) {
    throw new Error(
      'E2E requiere el runner aislado, NODE_ENV=test y TEST_DATABASE_URL explícita',
    );
  }
  const configured = new URL(process.env.TEST_DATABASE_URL);
  const actual = new URL(process.env.DATABASE_URL);
  if (
    !configured.pathname.endsWith('_test') ||
    actual.pathname !== configured.pathname ||
    actual.origin !== configured.origin ||
    actual.host !== configured.host ||
    actual.username !== configured.username ||
    actual.password !== configured.password ||
    !/^e2e_[a-f0-9]{32}$/.test(actual.searchParams.get('schema') ?? '')
  ) {
    throw new Error(
      'E2E bloqueado: la base o el schema no son exclusivos de pruebas',
    );
  }
  return actual;
}
