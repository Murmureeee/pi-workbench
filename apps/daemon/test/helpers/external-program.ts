import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Real, short-lived local process fixture. Windows compiles a windowless .NET executable;
 * other hosts use an executable Node script. Neither is an IDE or a model provider. */
export function externalProgram(root: string) {
  const path = join(root, 'local editor.exe'),
    fail = join(root, 'fail.exe')
  if (process.platform === 'win32') {
    const source = join(root, 'external-program.cs')
    writeFileSync(
      source,
      `using System; using System.IO; using System.Text;
class Fixture { static int Main(string[] args) {
string self = System.Reflection.Assembly.GetExecutingAssembly().Location;
if (Path.GetFileName(self) == "fail.exe") return 7;
File.WriteAllLines(self + ".args", Array.ConvertAll(args, a => Convert.ToBase64String(Encoding.UTF8.GetBytes(a)))); return 0;
} }`,
    )
    execFileSync(
      join(
        process.env.WINDIR ?? 'C:\\Windows',
        'Microsoft.NET',
        'Framework64',
        'v4.0.30319',
        'csc.exe',
      ),
      ['/nologo', '/target:winexe', `/out:${path}`, source],
      { windowsHide: true },
    )
  } else {
    writeFileSync(
      path,
      '#!' +
        process.execPath +
        '\n' +
        'const fs=require("node:fs"); if(process.argv[1].endsWith("fail.exe"))process.exit(7);fs.writeFileSync(process.argv[1]+".args",process.argv.slice(2).map(a=>Buffer.from(a).toString("base64")).join("\\n"));',
    )
    chmodSync(path, 0o700)
  }
  copyFileSync(path, fail)
  if (process.platform !== 'win32') {
    chmodSync(fail, 0o700)
  }
  return { path, fail }
}
