import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { z } from 'zod'

// Fixed host code, never interpolated with a renderer path or document. Payload travels
// only over stdin. FileShare.None also refuses an already open incompatible writer.
const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
public static class PiwFileSave {
  [StructLayout(LayoutKind.Sequential)] struct Info {
    public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [StructLayout(LayoutKind.Sequential)] struct Basic {
    public long Created, Accessed, Written, Changed; public uint Attributes;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int kind, out Basic info, uint size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
  static string Identity(SafeFileHandle handle, string path, bool directory) {
    Info i;
    if (handle.IsInvalid || !GetFileInformationByHandle(handle, out i) || (i.Attributes & 0x400) != 0 || (!directory && (i.Links != 1 || (i.Attributes & 0x10) != 0))) throw new IOException("identity");
    var full = new StringBuilder(32768);
    if (GetFinalPathNameByHandleW(handle, full, 32768, 0) == 0 || !String.Equals(full.ToString(), path, StringComparison.Ordinal)) throw new IOException("canonical");
    return i.Volume+":"+i.IndexHigh+":"+i.IndexLow+":"+i.Created.dwHighDateTime+":"+i.Created.dwLowDateTime;
  }
  static string Metadata(FileStream stream, string path) {
    Basic b;
    if (!GetFileInformationByHandleEx(stream.SafeFileHandle, 0, out b, (uint)Marshal.SizeOf(typeof(Basic)))) throw new IOException("metadata");
    return Identity(stream.SafeFileHandle, path, false)+":"+b.Written+":"+b.Changed+":"+b.Attributes+":"+File.GetAccessControl(path, AccessControlSections.Access|AccessControlSections.Owner|AccessControlSections.Group).GetSecurityDescriptorSddlForm(AccessControlSections.Access|AccessControlSections.Owner|AccessControlSections.Group);
  }
  static string Hash(string metadata, byte[] bytes) {
    using (var hash = SHA256.Create()) {
      byte[] prefix = Encoding.UTF8.GetBytes(metadata+"\n");
      hash.TransformBlock(prefix, 0, prefix.Length, null, 0);
      hash.TransformFinalBlock(bytes, 0, bytes.Length);
      return BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant();
    }
  }
  public static string[] Run(string input, string expected, string replacement, bool saving) {
    string full = Path.GetFullPath(input);
    if (full.StartsWith(@"\\") && !full.StartsWith(@"\\?\")) throw new IOException("network");
    string path = full.StartsWith(@"\\?\") ? full : @"\\?\"+full;
    var parents = new List<SafeFileHandle>();
    try {
      var dirs = new List<string>();
      for (string p = Path.GetDirectoryName(full); p != null; p = Path.GetDirectoryName(p)) dirs.Insert(0, p);
      string chain = "";
      foreach (string p in dirs) {
        string extended = p.StartsWith(@"\\?\") ? p : @"\\?\"+p;
        var h = CreateFileW(extended, 0x80, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
        parents.Add(h);
        chain += Identity(h, extended, true)+"|";
      }
      using (var stream = new FileStream(path, FileMode.Open, saving ? FileAccess.ReadWrite : FileAccess.Read, FileShare.None)) {
        if (stream.Length > 262144) throw new IOException("limit");
        string before = Metadata(stream, path);
        byte[] original = new byte[(int)stream.Length];
        int count = 0;
        while (count < original.Length) { int n=stream.Read(original, count, original.Length-count); if(n==0) throw new IOException("short"); count+=n; }
        if (before != Metadata(stream, path)) throw new IOException("changed");
        string version = Hash(chain+before, original);
        if (!saving) return new string[]{"ready", version, Convert.ToBase64String(original)};
        if (version != expected) return new string[]{"changed", version, ""};
        byte[] next = Convert.FromBase64String(replacement);
        if (next.Length > 262144) throw new IOException("limit");
        try { stream.Position=0; stream.Write(next, 0, next.Length); stream.SetLength(next.Length); stream.Flush(true); }
        catch {
          try { stream.Position=0; stream.Write(original,0,original.Length); stream.SetLength(original.Length); stream.Flush(true); }
          catch { return new string[]{"uncertain", version, ""}; }
          return new string[]{"failed", version, ""};
        }
        return new string[]{"saved", Hash(chain+Metadata(stream,path),next), ""};
      }
    } finally { foreach (var h in parents) h.Dispose(); }
  }
}
'@
try {
  $q = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $replacement = $null
  if ($q.mode -eq 'save') { $replacement = [string]$q.bytes }
  $r = [PiwFileSave]::Run([string]$q.path, [string]$q.version, $replacement, ($q.mode -eq 'save'))
  @{status=$r[0];version=$r[1];bytes=$r[2]} | ConvertTo-Json -Compress
} catch { @{status='unavailable';version='';bytes=''} | ConvertTo-Json -Compress }
`
const resultSchema = z.object({
  status: z.enum(['ready', 'saved', 'changed', 'failed', 'uncertain', 'unavailable']),
  version: z.string(),
  bytes: z.string(),
})

/** Windows-only, bounded exclusive descriptor boundary. Holds all ancestors against
 * rename/delete, rejects reparse/hard links, versions ACL/identity/metadata/full bytes,
 * and fsyncs writes. No create/delete/rename or shell interpolation. Once started it is
 * drained rather than killed on client cancellation; OS/process failure may leave an
 * uncertain write, never an automatic retry. Unsupported hosts fail closed. */
export function windowsFileSave(path: string, version?: string, bytes?: Buffer) {
  if (process.platform !== 'win32' || !process.env.SystemRoot) {
    throw new Error('当前宿主没有已验证的独占保存边界，仅支持 Windows。')
  }
  return new Promise<z.infer<typeof resultSchema>>((resolve, reject) => {
    const child = spawn(
      join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    let output = '',
      overflow = false
    child.stdout.on('data', (part: Buffer) => {
      if (output.length + part.length > 1024 * 1024) {
        overflow = true
        return
      }
      output += part.toString('utf8')
    })
    // Diagnostics cannot echo document bytes, paths or ACLs into application logs.
    child.stderr.resume()
    child.once('error', reject)
    child.stdin.on('error', () => undefined)
    child.once('close', (code) => {
      try {
        if (code !== 0 || overflow) {
          throw new Error('保存边界不可用；请保留编辑稿并核对磁盘。')
        }
        resolve(resultSchema.parse(JSON.parse(output.replace(/^\ufeff/, ''))))
      } catch {
        reject(new Error('保存结果无法核对；编辑稿保留，请重新检查磁盘。'))
      }
    })
    child.stdin.end(
      JSON.stringify({
        path,
        version,
        bytes: bytes?.toString('base64'),
        mode: bytes ? 'save' : 'inspect',
      }),
    )
  })
}
