// /tp wordt door middleware.js beantwoord met kale HTML (lib/tp-verify.js),
// zodat de Travelpayouts-checker het script in de <head> ziet. Deze pagina
// wordt in de praktijk nooit getoond.
export default function Tp() {
  return null;
}
