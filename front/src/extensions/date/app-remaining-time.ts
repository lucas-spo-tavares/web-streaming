type AppRemainingTimeOptions = {
  now: number;
};

declare global {
  interface Date {
    /**
     * Calcula o tempo restante até esta data a partir de uma referência explícita.
     *
     * @param options - Referência usada no cálculo.
     * @param options.now - Instante de referência em milissegundos desde a época Unix.
     * @returns Dias e horas, horas e minutos, minutos ou "Expirado".
     */
    appRemainingTime(options: AppRemainingTimeOptions): string;
  }
}

/**
 * Formata o tempo entre a referência recebida e a data da chamada, sem consultar o relógio.
 *
 * @param options - Referência usada no cálculo.
 * @param options.now - Instante de referência em milissegundos desde a época Unix.
 * @returns Dias e horas, horas e minutos, minutos ou "Expirado".
 */
Date.prototype.appRemainingTime = function appRemainingTime({
  now,
}: AppRemainingTimeOptions): string {
  const diff = Math.max(0, this.getTime() - now);

  if (!diff) return 'Expirado';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);

  if (days) return `${days}d ${hours}h`;

  if (hours) return `${hours}h ${Math.floor((diff % 3600000) / 60000)}min`;

  return `${Math.max(1, Math.ceil(diff / 60000))}min`;
};

export {};
