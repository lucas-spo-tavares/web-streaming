type AppBytesFormatOptions = {
  lang?: string;
};

declare global {
  interface Number {
    /**
     * Formata este número de bytes em B, KiB, MiB ou GiB.
     *
     * @param options - Opções de formatação.
     * @param options.lang - Locale usado no valor numérico. Padrão: pt-BR.
     * @returns Tamanho formatado com até uma casa decimal e sua unidade.
     */
    appBytesFormat(options?: AppBytesFormatOptions): string;
  }
}

/**
 * Formata o número da chamada como um tamanho em bytes.
 *
 * @param options - Opções de formatação.
 * @param options.lang - Locale usado no valor numérico. Padrão: pt-BR.
 * @returns Tamanho em B, KiB, MiB ou GiB, com até uma casa decimal.
 */
Number.prototype.appBytesFormat = function appBytesFormat({
  lang = 'pt-BR',
}: AppBytesFormatOptions = {}): string {
  const size = this.valueOf();

  if (size < 1024) return `${size} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  const i = Math.min(Math.floor(Math.log(size) / Math.log(1024)) - 1, 2);

  return `${(size / 1024 ** (i + 1)).toLocaleString(lang, { maximumFractionDigits: 1 })} ${units[i]}`;
};

export {};
