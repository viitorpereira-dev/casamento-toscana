# casamento-toscana

## Álbuns de fotos

No painel `admin.html`, em **Galeria**, escolha **Diário de estrada** ou **Um capítulo novo** antes de selecionar as imagens. É possível publicar várias fotos, editar título, subtítulo e enquadramento, mudar a ordem e excluir fotos de cada álbum. Publique ou remova a fila antes de trocar de álbum.

O álbum **Um capítulo novo** ocupa o lugar da ilustração na segunda seção. Usa o mesmo carrossel, navegação por toque e ampliação da galeria existente. Se estiver vazio, exibe uma mensagem discreta.

Não há migração de banco: os dois álbuns usam `gallery_photos` e o bucket `gallery` já existentes. Fotos do novo álbum são armazenadas no prefixo `story/`; fotos anteriores continuam no Diário de estrada. A API aceita `?album=story` ou `?album=travel` (padrão). A ordenação usa a função `reorder_gallery_photos` já utilizada pela galeria.

Execute os testes com Node.js 22 ou superior: `node --test tests/*.test.mjs`.


## Categorias dos presentes

A lista e o painel compartilham as definições de `gift-categories.js`: utensílios de cozinha, eletrodomésticos, mesa posta, móveis, cama e banho, decoração, eletrônicos, lavanderia, lua de mel, contribuições e brincadeiras. `Outros` recebe categorias desconhecidas; os valores antigos `quarto` e `sala` continuam compatíveis.

O convite mostra apenas categorias com presentes publicados, com contadores e um seletor no celular. No painel, todas as categorias estão disponíveis no formulário, e a lista de cadastros também pode ser filtrada. Presentes indisponíveis podem ser salvos sem link de pagamento; publicar um presente exige o link do Mercado Pago.

O script `scripts/reorganize-gift-categories.sql` reclassifica os cadastros existentes e ordena os disponíveis primeiro, seguindo categoria e preço. Execute-o no projeto Supabase do casamento ao aplicar esta atualização. Ele preserva valores, imagens, links e disponibilidade.
