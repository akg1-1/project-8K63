# Основная страница репозитория

## Краткая инструкция по работе с репозиторием проекта
[Ссылка на статью про гит на Habr](https://habr.com/ru/articles/541258/)
### Скачивание своей ветки

```bash
git clone -b web-site --single-branch https://github.com/akg1-1/project-8K63.git #Для веб-сайта
```

```bash
git clone -b data-base --single-branch https://github.com/akg1-1/project-8K63.git #Для базы данных
```

```bash
git clone -b api --single-branch https://github.com/akg1-1/project-8K63.git #Для серверного приложения
```

### Скачивание изменений из Github (если репозиторий уже загружен)
```bash
git pull
```

### Отправка изменений на Github
```bash
git add .
git commit -m "Название коммита"
git push
```
