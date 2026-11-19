// PIN fácil de adivinhar — mesma regra da API (finance_api/auth/service.py: is_weak_pin).
// Vale só ao redefinir o PIN; o login aceita os PINs já gravados.
const COMMON_PINS = new Set([
  "112233", "332211", "111222", "000111", "123321", "654456", "102030", "121314",
  "147258", "258369", "159753", "159357", "147852", "123654", "789456", "456123",
]);

export const WEAK_PIN_MESSAGE =
  "PIN fácil demais: evite sequências (123456), repetições (111111) e padrões (121212).";

export function isWeakPin(pin: string): boolean {
  if (COMMON_PINS.has(pin) || new Set(pin).size === 1) return true;
  const steps = new Set<number>();
  for (let i = 1; i < pin.length; i++) steps.add((Number(pin[i]) - Number(pin[i - 1]) + 10) % 10);
  if (steps.size === 1 && (steps.has(1) || steps.has(9))) return true;
  return [2, 3].some((n) => pin === pin.slice(0, n).repeat(pin.length).slice(0, pin.length));
}
