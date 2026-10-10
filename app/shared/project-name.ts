export function projectNameHasControls(name: string): boolean {
  return /[\p{Cc}\u2028\u2029]/u.test(name);
}

export function projectNameError(name: string): string {
  if (projectNameHasControls(name)) return '项目名称不能包含换行或控制字符';
  return name.trim() ? '' : '请输入项目名称';
}

export function projectNameFromDirectory(directory: string): string {
  const leaf = directory.replace(/\/+$/, '').split('/').at(-1) ?? '';
  return leaf.replace(/\r\n|[\r\n\t\u0085\u2028\u2029]/g, ' ').replace(/\p{Cc}/gu, '').trim();
}
