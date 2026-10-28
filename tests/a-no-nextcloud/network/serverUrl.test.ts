import { parseServerUrl } from '../../../src/network/serverUrl';

describe('[SPEC:SD-4] parseServerUrl splits the Server URL at its DAV entry point', () => {
  it.each([
    { id: 'U-1', serverUrl: 'https://h/remote.php/dav/files/alice/', rootUrl: 'https://h', isPublicShare: false },
    { id: 'U-2', serverUrl: 'https://h/remote.php/webdav/', rootUrl: 'https://h', isPublicShare: false },
    { id: 'U-3', serverUrl: 'https://h/nextcloud/remote.php/dav/files/alice/Vault', rootUrl: 'https://h/nextcloud', isPublicShare: false },
    { id: 'U-4', serverUrl: 'https://h/public.php/webdav/', rootUrl: 'https://h', isPublicShare: true },
    { id: 'U-5', serverUrl: 'https://h/public.php/dav/files/TOKEN/', rootUrl: 'https://h', isPublicShare: true },
    { id: 'U-6', serverUrl: 'https://h/nextcloud/public.php/webdav/', rootUrl: 'https://h/nextcloud', isPublicShare: true },
    { id: 'U-7', serverUrl: 'https://h/nextcloud/public.php/dav/files/TOKEN/', rootUrl: 'https://h/nextcloud', isPublicShare: true },
    { id: 'U-8', serverUrl: 'https://h/public.php/webdav', rootUrl: 'https://h', isPublicShare: true },
    // A folder named public.php under the account is not a public share entry point.
    { id: 'U-9', serverUrl: 'https://h/remote.php/dav/files/alice/public.php/', rootUrl: 'https://h', isPublicShare: false },
    // Plain WebDAV: unchanged.
    { id: 'U-10', serverUrl: 'https://dav.example.com/dav/', rootUrl: 'https://dav.example.com/dav/', isPublicShare: false },
    { id: 'U-11', serverUrl: '', rootUrl: '', isPublicShare: false },
  ])('$id: $serverUrl', ({ serverUrl, rootUrl, isPublicShare }) => {
    expect(parseServerUrl(serverUrl)).toEqual({ rootUrl, isPublicShare });
  });
});
