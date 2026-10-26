function Get-NcmStoreLaunchTarget {
    param([Parameter(Mandatory = $true)]$Package)
    $manifestPath = Join-Path $Package.InstallLocation 'AppxManifest.xml'
    [xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
    $applications = @($manifest.Package.Applications.Application | Where-Object {
        [string]$_.Executable -match '(?i)(^|[\\/])cloudmusic\.exe$'
    })
    if ($applications.Count -ne 1) { throw '商店安装包中没有唯一的网易云启动入口。' }
    $applicationId = [string]$applications[0].Id
    $family = [string]$Package.PackageFamilyName
    if (-not $applicationId -or -not $family -or $applicationId.Contains('!') -or $family.Contains('!')) {
        throw '商店安装包的应用标识不正确。'
    }
    [pscustomobject]@{ Kind = 'Store'; AppUserModelId = $family + '!' + $applicationId }
}

function Initialize-NcmStoreActivator {
    if ('NcmKnowledge.StoreActivator' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace NcmKnowledge {
    [ComImport]
    [Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IApplicationActivationManager {
        [PreserveSig]
        int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
        [PreserveSig]
        int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string appId, IntPtr items,
            [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint processId);
        [PreserveSig]
        int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string appId, IntPtr items, out uint processId);
    }

    public static class StoreActivator {
        [DllImport("ole32.dll", ExactSpelling = true, PreserveSig = true)]
        private static extern int CoCreateInstance(ref Guid classId, IntPtr outer, uint context,
            ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out IApplicationActivationManager manager);

        public static uint Launch(string appId, string arguments) {
            Guid classId = new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C");
            Guid interfaceId = new Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D");
            IApplicationActivationManager manager;
            // A short-lived launcher uses the system's out-of-process activation manager.
            Marshal.ThrowExceptionForHR(CoCreateInstance(ref classId, IntPtr.Zero, 4, ref interfaceId, out manager));
            try {
                uint processId;
                Marshal.ThrowExceptionForHR(manager.ActivateApplication(appId, arguments, 0, out processId));
                return processId;
            } finally { Marshal.ReleaseComObject(manager); }
        }
    }
}
'@
}

function Start-NcmStoreApplication {
    param([Parameter(Mandatory = $true)][string]$AppUserModelId, [string]$Arguments)
    Initialize-NcmStoreActivator
    [void][NcmKnowledge.StoreActivator]::Launch($AppUserModelId, $Arguments)
}
