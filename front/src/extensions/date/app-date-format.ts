type AppDateFormatOptions = {
  lang?: string;
};

declare global {
  interface Date {
    /**
     * Formata esta data com dia, mês, ano, hora e minuto no fuso do ambiente.
     *
     * @param options - Opções de formatação.
     * @param options.lang - Locale usado na formatação. Padrão: pt-BR.
     * @returns Data e horário formatados.
     */
    appDateFormat(options?: AppDateFormatOptions): string;
  }
}

/**
 * Formata a data da chamada com dia, mês, ano, hora e minuto no fuso do ambiente.
 *
 * @param options - Opções de formatação.
 * @param options.lang - Locale usado na formatação. Padrão: pt-BR.
 * @returns Data e horário formatados.
 */
Date.prototype.appDateFormat = function appDateFormat({
  lang = 'pt-BR',
}: AppDateFormatOptions = {}): string {
  return this.toLocaleString(lang, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export {};
