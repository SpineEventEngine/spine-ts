# Third-party source notice

The adapted Button, Input and Sheet components in `src/ui` derive from the official shadcn/ui New York v4 registry source, used under the MIT License. The retained registry payloads and source hashes are recorded in `implementation-evidence/examples-revision/shadcn-source` outside this package.

The `predev` and `prebuild` scripts copy the pinned MapLibre GL JS 6.16.0 module worker and its full upstream `LICENSE.txt` from the installed package into `public/`. Both generated copies are excluded from source control and must be present in the deployed Next public assets. The same-origin worker URL is configured in `src/place-map.tsx`.

## MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
