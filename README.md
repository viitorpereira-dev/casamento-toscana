# casamento-toscana

## Álbuns de fotos

No painel `admin.html`, em **Galeria**, escolha **Diário de estrada** ou **Um capítulo novo** antes de selecionar as imagens. É possível publicar várias fotos, editar título, subtítulo e enquadramento, mudar a ordem e excluir fotos de cada álbum. Publique ou remova a fila antes de trocar de álbum.

O álbum **Um capítulo novo** ocupa o lugar da ilustração na segunda seção. Usa o mesmo carrossel, navegação por toque e ampliação da galeria existente. Se estiver vazio, exibe uma mensagem discreta.

Não há migração de banco: os dois álbuns usam `gallery_photos` e o bucket `gallery` já existentes. Fotos do novo álbum são armazenadas no prefixo `story/`; fotos anteriores continuam no Diário de estrada. A API aceita `?album=story` ou `?album=travel` (padrão). A ordenação usa a função `reorder_gallery_photos` já utilizada pela galeria.

Execute os testes com Node.js 22 ou superior: `node --test tests/*.test.mjs`.
