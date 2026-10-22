# Provenance et licences du corpus

## `gitlab-templates/`

Templates CI/CD officiels copiés **sans modification** depuis le dépôt
[`gitlab-org/gitlab`](https://gitlab.com/gitlab-org/gitlab).

| | |
| --- | --- |
| Dépôt source | `https://gitlab.com/gitlab-org/gitlab` |
| Commit épinglé | `12bfbf8ea1eaa681436f08f4ca059bb1cd7074ba` |
| Date du commit | 2026-10-20 |
| Licence | **MIT (Expat)**, Copyright GitLab Inc. 2011-present |
| Fichier de licence | <https://gitlab.com/gitlab-org/gitlab/-/raw/12bfbf8ea1eaa681436f08f4ca059bb1cd7074ba/LICENSE> |

Le `LICENSE` à la racine du dépôt source place l'ensemble du dépôt sous MIT Expat, à trois
exclusions près, explicitement énumérées : le contenu de `doc/` (CC BY-SA 4.0), celui de `ee/`
(licence définie dans `ee/LICENSE`) et celui de `jh/` (licence définie dans `jh/LICENSE`). Tous les
fichiers ci-dessous proviennent de `lib/gitlab/ci/templates/`, qui n'est dans aucune de ces
exclusions : ils sont donc sous MIT. **Aucun fichier n'a été copié depuis `ee/`, `jh/` ou `doc/`.**

Les noms de fichiers ont été aplatis (`/` remplacé par `-`) pour tenir dans un seul dossier ; le
contenu est octet pour octet celui du dépôt source, ce que vérifie la colonne SHA-256.

### Texte intégral de la licence du dépôt source

La licence MIT exige que la notice de copyright et la notice de permission soient reproduites dans
toute copie ou portion substantielle du logiciel. Le `LICENSE` du commit épinglé est donc reproduit
ici **verbatim**, notice de copyright comprise.

```
Copyright (c) 2011-present GitLab Inc.

Portions of this software are licensed as follows:

* All content residing under the "doc/" directory of this repository is licensed under "Creative Commons: CC BY-SA 4.0 license".
* All content that resides under the "ee/" directory of this repository, if that directory exists, is licensed under the license defined in "ee/LICENSE".
* All content that resides under the "jh/" directory of this repository, if that directory exists, is licensed under the license defined in "jh/LICENSE".
* All client-side JavaScript (when served directly or after being compiled, arranged, augmented, or combined), is licensed under the "MIT Expat" license.
* All third party components incorporated into the GitLab Software are licensed under the original license provided by the owner of the applicable component.
* Content outside of the above mentioned directories or restrictions above is available under the "MIT Expat" license as defined below.

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
```

| Fichier local | Chemin d'origine | Licence | Octets | SHA-256 du contenu |
| --- | --- | --- | --- | --- |
| `Go.gitlab-ci.yml` | `lib/gitlab/ci/templates/Go.gitlab-ci.yml` | MIT | 943 | `f5f05171c06598f1f0a3aa3202c87388d15f8321e0b632a7d51cfe24cb54e1bd` |
| `Python.gitlab-ci.yml` | `lib/gitlab/ci/templates/Python.gitlab-ci.yml` | MIT | 1361 | `1af6a8704fa5bc0be67464d9a406a2e3d0214d8b5927feaa2f372a0c4f5b7f01` |
| `Ruby.gitlab-ci.yml` | `lib/gitlab/ci/templates/Ruby.gitlab-ci.yml` | MIT | 2038 | `947f0a49c5f65265dcbbecf2a8b08093428e6235c38188769785ae025f1c9726` |
| `Nodejs.gitlab-ci.yml` | `lib/gitlab/ci/templates/Nodejs.gitlab-ci.yml` | MIT | 1241 | `560a1e667ad35de26c85337d6f53562cbf30aaf3c16b4bdfd7d01e437ea51e49` |
| `Rust.gitlab-ci.yml` | `lib/gitlab/ci/templates/Rust.gitlab-ci.yml` | MIT | 1766 | `080aa4870b6d1d972bdcda91713cdf734f12ffbd1d106b8e4e4b44b42e311512` |
| `PHP.gitlab-ci.yml` | `lib/gitlab/ci/templates/PHP.gitlab-ci.yml` | MIT | 1950 | `021711555a31205228285b7b4b3def17d513fd06a65f0c71fea19d0d28b1891d` |
| `Maven.gitlab-ci.yml` | `lib/gitlab/ci/templates/Maven.gitlab-ci.yml` | MIT | 3563 | `ffacb1eb647c54c560a76fe2da2f2549535eeda8f5b8b4d19cf2c60a696d1196` |
| `dotNET-Core.gitlab-ci.yml` | `lib/gitlab/ci/templates/dotNET-Core.gitlab-ci.yml` | MIT | 5236 | `7b5cc4b8ad605de12b1c19cdad2c7ac8fa989b468f2582aea64afbfa67a778f8` |
| `Android.gitlab-ci.yml` | `lib/gitlab/ci/templates/Android.gitlab-ci.yml` | MIT | 3544 | `cbfa2dc9a65608ec0a2ded20cc87926da695636bdc88de2bedad97a59e13ac4d` |
| `Docker.gitlab-ci.yml` | `lib/gitlab/ci/templates/Docker.gitlab-ci.yml` | MIT | 1399 | `02602120e39674d6f4badc5a9df4b43b35eeb86f3f4c5627a3c117df5e2a43bc` |
| `Kaniko.gitlab-ci.yml` | `lib/gitlab/ci/templates/Kaniko.gitlab-ci.yml` | MIT | 3628 | `a3ddd4c9de9ad0d68a539b13c1ea019f5574823757cd30e5a7d8d9af02d3a0f0` |
| `Cosign.gitlab-ci.yml` | `lib/gitlab/ci/templates/Cosign.gitlab-ci.yml` | MIT | 995 | `3a6640d81c03e503eee110ea039cde957e27849f4e4ebb51d498241141184de2` |
| `Code-Quality.gitlab-ci.yml` | `lib/gitlab/ci/templates/Code-Quality.gitlab-ci.yml` | MIT | 55 | `fa3a3cf62e0c7d4d52f9ec3b9f7bf5be8994fefbb34738391e19bfee74cfe9f8` |
| `Getting-Started.gitlab-ci.yml` | `lib/gitlab/ci/templates/Getting-Started.gitlab-ci.yml` | MIT | 2007 | `15eea2725b0030ad39f3f3ac8809600fc369c134cf954dba75ce22f16368faf0` |
| `Auto-DevOps.gitlab-ci.yml` | `lib/gitlab/ci/templates/Auto-DevOps.gitlab-ci.yml` | MIT | 8119 | `f80e4d2e3688446a3d288d7c67136c624d5ae0da177f1608c950c5cd09057470` |
| `Terraform-Module-Base.gitlab-ci.yml` | `lib/gitlab/ci/templates/Terraform/Module-Base.gitlab-ci.yml` | MIT | 2178 | `693156973d6ba4a2904cfaf3cf7a160ae6203732f7ec648c0c3a0a32dfeea8f2` |
| `Security-SAST.gitlab-ci.yml` | `lib/gitlab/ci/templates/Security/SAST.gitlab-ci.yml` | MIT | 174 | `3d5fd1c90d07951496a88617866602e6b764ca0dbd50ce9163692d6c724b9dec` |
| `Security-Secret-Detection.gitlab-ci.yml` | `lib/gitlab/ci/templates/Security/Secret-Detection.gitlab-ci.yml` | MIT | 198 | `fefa0679c5cdb0f66ef8e63948934a1ebf1521ab55d2ef96064876236e0f399a` |
| `Security-Container-Scanning.gitlab-ci.yml` | `lib/gitlab/ci/templates/Security/Container-Scanning.gitlab-ci.yml` | MIT | 202 | `a891b6a8ccaf14a57ce5be2c101c05bddbb788ae01f80ee76e872f3d54125155` |
| `Security-DAST.gitlab-ci.yml` | `lib/gitlab/ci/templates/Security/DAST.gitlab-ci.yml` | MIT | 3920 | `9073ddd6d4b4dd3b97da893c6e324285cf6273319b3ac58de625fee7769fdf54` |

Total : 20 fichiers.

### Vérifier cette table

```sh
cd packages/adapter-gitlab/test/corpus/gitlab-templates && sha256sum -c ../CHECKSUMS.txt
```

## `edge-cases/`

Fixtures écrites à la main pour ce dépôt, sous la licence du projet (**Apache-2.0**, Copyright 2026
Khalid Ouhmid). Elles ne proviennent d'aucun tiers.

## Interdit dans ce corpus

Aucun fichier de CI provenant d'un employeur ou d'un client, présent ou passé.
