# binaries/

Бинарники пакета СВЧ. Хранилище версий, не редактируется в репо.

## Что лежит здесь

| Файл | Что это | Заливает |
|---|---|---|
| `operator-pnl-7y.csv` | Текстовый экспорт модели Оператора 7Y (CSV из xlsx) — для grep/diff/чтения сессией без открытия Excel | Сессии (через GTHB API) |
| `ЦТИ_ГИС.pptx` | Боевая презентация — последняя версия | G руками через GitHub Web (drag-drop) |
| `ЦТИ_ГИС.key` | Боевая Keynote-исходник | G руками |
| `ЦТИ_ГИС.pdf` | PDF-экспорт боевой презы | G руками |
| `operator-pnl-7y.xlsx` | Модель Оператора 7Y — оригинал | G руками |

## Почему .pptx/.key/.pdf/.xlsx не через сессию

Сессия может залить только текст и base64-кодированный бинарь через GTHB API. PPTX размером ~213 KB в base64 ≈ 71k токенов в контексте сессии — слишком дорого, съедает запас на содержательную работу. Заливка drag-drop через GitHub Web занимает 5 секунд.

## Как залить через GitHub Web

1. Открыть https://github.com/Grantik/rostec-map/tree/main/materials/svch-package/binaries
2. «Add file» → «Upload files»
3. Drag-drop файл в окно
4. Commit message: `binaries: upload <filename> v<N>`
5. Commit directly to main

После заливки в этой папке файл становится постоянным и доступен любой сессии через `GTHB:get_file_contents` (для текста) или ссылку RAW.
